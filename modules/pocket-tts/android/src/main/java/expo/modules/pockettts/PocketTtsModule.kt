package expo.modules.pockettts

import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.Voice
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS <-> native bridge for background read-aloud. Playback itself lives in
 * [TtsForegroundService] (so it survives backgrounding); this module only sends
 * commands to that service and relays the service's events up to JS.
 *
 * A short-lived, module-owned [TextToSpeech] is used solely to enumerate voices
 * — the speaking engine is the service's own instance.
 */
class PocketTtsModule : Module() {

  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context unavailable" }

  private var enumTts: TextToSpeech? = null

  override fun definition() = ModuleDefinition {
    Name("PocketTts")

    Events("onSegment", "onDone", "onError", "onRemoteCommand")

    OnCreate { INSTANCE = this@PocketTtsModule }

    OnDestroy {
      if (INSTANCE === this@PocketTtsModule) INSTANCE = null
      enumTts?.shutdown()
      enumTts = null
    }

    Function("isAvailable") { true }

    Function("speak") {
        chunks: List<String>,
        segments: List<Int>,
        startSegment: Int,
        rate: Double,
        pitch: Double,
        voice: String?,
      ->
      val intent = serviceIntent(TtsForegroundService.ACTION_SPEAK).apply {
        putStringArrayListExtra(TtsForegroundService.EXTRA_CHUNKS, ArrayList(chunks))
        putIntegerArrayListExtra(TtsForegroundService.EXTRA_SEGMENTS, ArrayList(segments))
        putExtra(TtsForegroundService.EXTRA_START_SEGMENT, startSegment)
        putExtra(TtsForegroundService.EXTRA_RATE, rate.toFloat())
        putExtra(TtsForegroundService.EXTRA_PITCH, pitch.toFloat())
        putExtra(TtsForegroundService.EXTRA_VOICE, voice)
      }
      ContextCompat.startForegroundService(context, intent)
    }

    Function("pause") { sendAction(TtsForegroundService.ACTION_PAUSE) }
    Function("resume") { sendAction(TtsForegroundService.ACTION_RESUME) }
    Function("stop") { sendAction(TtsForegroundService.ACTION_STOP) }

    Function("setOptions") { rate: Double, pitch: Double, voice: String? ->
      val intent = serviceIntent(TtsForegroundService.ACTION_SET_OPTIONS).apply {
        putExtra(TtsForegroundService.EXTRA_RATE, rate.toFloat())
        putExtra(TtsForegroundService.EXTRA_PITCH, pitch.toFloat())
        putExtra(TtsForegroundService.EXTRA_VOICE, voice)
      }
      ContextCompat.startForegroundService(context, intent)
    }

    Function("skip") { delta: Int ->
      val intent = serviceIntent(TtsForegroundService.ACTION_SKIP).apply {
        putExtra(TtsForegroundService.EXTRA_DELTA, delta)
      }
      ContextCompat.startForegroundService(context, intent)
    }

    Function("setNowPlaying") { title: String, chapter: String ->
      val intent = serviceIntent(TtsForegroundService.ACTION_NOWPLAYING).apply {
        putExtra(TtsForegroundService.EXTRA_TITLE, title)
        putExtra(TtsForegroundService.EXTRA_CHAPTER, chapter)
      }
      ContextCompat.startForegroundService(context, intent)
    }

    AsyncFunction("getVoices") { promise: Promise ->
      withEnumTts { tts ->
        val voices = tts?.voices?.map { v: Voice ->
          mapOf(
            "identifier" to v.name,
            "name" to v.name,
            "language" to (v.locale?.toLanguageTag() ?: ""),
          )
        } ?: emptyList()
        promise.resolve(voices)
      }
    }
  }

  private fun serviceIntent(action: String) =
    Intent(context, TtsForegroundService::class.java).setAction(action)

  private fun sendAction(action: String) {
    ContextCompat.startForegroundService(context, serviceIntent(action))
  }

  private fun withEnumTts(block: (TextToSpeech?) -> Unit) {
    val existing = enumTts
    if (existing != null) {
      block(existing)
      return
    }
    var engine: TextToSpeech? = null
    engine = TextToSpeech(context.applicationContext) { status ->
      Handler(Looper.getMainLooper()).post {
        if (status == TextToSpeech.SUCCESS) {
          enumTts = engine
          block(engine)
        } else {
          block(null)
        }
      }
    }
  }

  private fun emit(event: String, body: Map<String, Any?>) {
    Handler(Looper.getMainLooper()).post { sendEvent(event, body) }
  }

  companion object {
    @Volatile
    private var INSTANCE: PocketTtsModule? = null

    /** Push an event to JS; a no-op if the JS side has gone away. */
    fun dispatch(event: String, body: Map<String, Any?>) {
      INSTANCE?.emit(event, body)
    }
  }
}
