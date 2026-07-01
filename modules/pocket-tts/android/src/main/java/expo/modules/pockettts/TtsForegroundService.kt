package expo.modules.pockettts

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.media.app.NotificationCompat.MediaStyle
import java.util.Locale

/**
 * Media-playback foreground service that drives the platform TextToSpeech engine.
 *
 * Why a service (not expo-speech): Android freezes a backgrounded app process, so
 * JS-driven utterance chaining dies on lock/background. Here the *service* owns
 * the engine and chains utterances natively, and a media foreground service keeps
 * the process alive — so read-aloud continues on the lock screen with transport
 * controls. Chapter changes (next/prev) are still decided in JS: the lock-screen
 * buttons emit `onRemoteCommand` and JS calls back in with the next chapter's text.
 */
class TtsForegroundService : Service() {

  private data class Chunk(val text: String, val segment: Int)

  private lateinit var tts: TextToSpeech
  private var ttsReady = false
  private lateinit var mediaSession: MediaSessionCompat
  private lateinit var audioManager: AudioManager
  private var focusRequest: AudioFocusRequest? = null
  private val main = Handler(Looper.getMainLooper())

  private var queue: List<Chunk> = emptyList()
  private var index = 0
  private var lastSegment = -1
  private var paused = false
  private var bookTitle = ""
  private var chapterTitle = ""

  // A pending "nothing is playing, shut down" check, cancelled if new speech arrives.
  private val idleStop = Runnable { if (!isActivelySpeaking()) stopEverything() }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
    setupMediaSession()
    tts = TextToSpeech(applicationContext) { status ->
      ttsReady = status == TextToSpeech.SUCCESS
      if (ttsReady) {
        tts.language = Locale("vi", "VN")
        tts.setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build(),
        )
        tts.setOnUtteranceProgressListener(progressListener)
      }
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_SPEAK -> handleSpeak(intent)
      ACTION_PAUSE -> pauseInternal(fromRemote = false)
      ACTION_RESUME -> resumeInternal(fromRemote = false)
      ACTION_STOP -> {
        PocketTtsModule.dispatch("onRemoteCommand", mapOf("command" to "stop"))
        stopEverything()
      }
      ACTION_NOWPLAYING -> {
        bookTitle = intent.getStringExtra(EXTRA_TITLE) ?: bookTitle
        chapterTitle = intent.getStringExtra(EXTRA_CHAPTER) ?: chapterTitle
        updateMetadata()
        startForegroundNow()
      }
      ACTION_REMOTE_NEXT -> PocketTtsModule.dispatch("onRemoteCommand", mapOf("command" to "next"))
      ACTION_REMOTE_PREV -> PocketTtsModule.dispatch("onRemoteCommand", mapOf("command" to "prev"))
    }
    return START_NOT_STICKY
  }

  private fun handleSpeak(intent: Intent) {
    main.removeCallbacks(idleStop)
    val chunks = intent.getStringArrayListExtra(EXTRA_CHUNKS) ?: arrayListOf()
    val segments = intent.getIntegerArrayListExtra(EXTRA_SEGMENTS) ?: arrayListOf()
    val startSegment = intent.getIntExtra(EXTRA_START_SEGMENT, 0)
    val rate = intent.getFloatExtra(EXTRA_RATE, 1f)
    val pitch = intent.getFloatExtra(EXTRA_PITCH, 1f)
    val voiceName = intent.getStringExtra(EXTRA_VOICE)

    queue = chunks.mapIndexed { i, text -> Chunk(text, segments.getOrElse(i) { 0 }) }
    // Skip to the first chunk at/after the requested paragraph (progress-bar seek).
    val start = queue.indexOfFirst { it.segment >= startSegment }.let { if (it < 0) 0 else it }

    if (queue.isEmpty()) return
    startForegroundNow()
    requestFocus()

    applyEngineOptions(rate, pitch, voiceName)
    paused = false
    lastSegment = -1
    speakFrom(start)
    setPlaybackState(PlaybackStateCompat.STATE_PLAYING)
  }

  private fun applyEngineOptions(rate: Float, pitch: Float, voiceName: String?) {
    if (!ttsReady) return
    tts.setSpeechRate(rate)
    tts.setPitch(pitch)
    if (voiceName != null) {
      tts.voices?.firstOrNull { it.name == voiceName }?.let { tts.voice = it }
    }
  }

  /** (Re)start speaking the queue from position [from], chaining natively. */
  private fun speakFrom(from: Int) {
    if (!ttsReady) return
    index = from
    tts.stop()
    for (i in from until queue.size) {
      val mode = if (i == from) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD
      tts.speak(queue[i].text, mode, null, "$UTT_PREFIX$i")
    }
  }

  private val progressListener = object : UtteranceProgressListener() {
    override fun onStart(utteranceId: String?) {
      val i = idOf(utteranceId) ?: return
      index = i
      val seg = queue.getOrNull(i)?.segment ?: return
      if (seg != lastSegment) {
        lastSegment = seg
        PocketTtsModule.dispatch("onSegment", mapOf("index" to seg))
      }
    }

    override fun onDone(utteranceId: String?) {
      val i = idOf(utteranceId) ?: return
      if (i >= queue.size - 1) {
        // Whole queue finished. Tell JS (it may auto-advance to the next chapter);
        // if nothing new arrives shortly, shut the service down.
        PocketTtsModule.dispatch("onDone", emptyMap())
        main.postDelayed(idleStop, IDLE_STOP_MS)
      }
    }

    @Deprecated("Deprecated in Java")
    override fun onError(utteranceId: String?) {
      PocketTtsModule.dispatch("onError", mapOf("message" to "TTS utterance error"))
    }

    override fun onError(utteranceId: String?, errorCode: Int) {
      PocketTtsModule.dispatch("onError", mapOf("message" to "TTS error $errorCode"))
    }
  }

  private fun pauseInternal(fromRemote: Boolean) {
    if (queue.isEmpty() || paused) return
    paused = true
    tts.stop() // Android TTS has no pause; resume re-speaks from `index`.
    setPlaybackState(PlaybackStateCompat.STATE_PAUSED)
    if (fromRemote) PocketTtsModule.dispatch("onRemoteCommand", mapOf("command" to "pause"))
  }

  private fun resumeInternal(fromRemote: Boolean) {
    if (queue.isEmpty() || !paused) return
    paused = false
    startForegroundNow()
    requestFocus()
    speakFrom(index)
    setPlaybackState(PlaybackStateCompat.STATE_PLAYING)
    if (fromRemote) PocketTtsModule.dispatch("onRemoteCommand", mapOf("command" to "play"))
  }

  private fun isActivelySpeaking(): Boolean = !paused && queue.isNotEmpty() && ttsReady && tts.isSpeaking

  private fun stopEverything() {
    main.removeCallbacks(idleStop)
    if (ttsReady) tts.stop()
    queue = emptyList()
    index = 0
    lastSegment = -1
    paused = false
    abandonFocus()
    setPlaybackState(PlaybackStateCompat.STATE_STOPPED)
    mediaSession.isActive = false
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  // --- MediaSession + notification ------------------------------------------

  private fun setupMediaSession() {
    mediaSession = MediaSessionCompat(this, "PocketTts").apply {
      setCallback(object : MediaSessionCompat.Callback() {
        override fun onPlay() = resumeInternal(fromRemote = true)
        override fun onPause() = pauseInternal(fromRemote = true)
        override fun onStop() {
          PocketTtsModule.dispatch("onRemoteCommand", mapOf("command" to "stop"))
          stopEverything()
        }
        override fun onSkipToNext() =
          PocketTtsModule.dispatch("onRemoteCommand", mapOf("command" to "next"))
        override fun onSkipToPrevious() =
          PocketTtsModule.dispatch("onRemoteCommand", mapOf("command" to "prev"))
      })
      isActive = true
    }
  }

  private fun setPlaybackState(state: Int) {
    val actions = PlaybackStateCompat.ACTION_PLAY or
      PlaybackStateCompat.ACTION_PAUSE or
      PlaybackStateCompat.ACTION_PLAY_PAUSE or
      PlaybackStateCompat.ACTION_STOP or
      PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
      PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
    mediaSession.setPlaybackState(
      PlaybackStateCompat.Builder()
        .setActions(actions)
        .setState(state, PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN, 1f)
        .build(),
    )
    // Refresh the notification so the play/pause button matches the state.
    if (state != PlaybackStateCompat.STATE_STOPPED) startForegroundNow()
  }

  private fun updateMetadata() {
    mediaSession.setMetadata(
      MediaMetadataCompat.Builder()
        .putString(MediaMetadataCompat.METADATA_KEY_TITLE, bookTitle)
        .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, chapterTitle)
        .build(),
    )
  }

  private fun startForegroundNow() {
    ensureChannel()
    val notif = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      ServiceCompat.startForeground(
        this,
        NOTIF_ID,
        notif,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
      )
    } else {
      startForeground(NOTIF_ID, notif)
    }
  }

  private fun buildNotification(): Notification {
    val playing = !paused && queue.isNotEmpty()
    val playPause = if (playing) {
      NotificationCompat.Action(
        android.R.drawable.ic_media_pause,
        "Pause",
        servicePending(ACTION_PAUSE),
      )
    } else {
      NotificationCompat.Action(
        android.R.drawable.ic_media_play,
        "Play",
        servicePending(ACTION_RESUME),
      )
    }

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle(bookTitle.ifEmpty { "Đang đọc" })
      .setContentText(chapterTitle)
      .setContentIntent(launchAppPending())
      .setOngoing(playing)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOnlyAlertOnce(true)
      .addAction(android.R.drawable.ic_media_previous, "Previous", servicePending(ACTION_REMOTE_PREV))
      .addAction(playPause)
      .addAction(android.R.drawable.ic_media_next, "Next", servicePending(ACTION_REMOTE_NEXT))
      .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop", servicePending(ACTION_STOP))
      .setStyle(
        MediaStyle()
          .setMediaSession(mediaSession.sessionToken)
          .setShowActionsInCompactView(0, 1, 2),
      )
      .build()
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val mgr = getSystemService(NotificationManager::class.java)
    if (mgr.getNotificationChannel(CHANNEL_ID) == null) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Đọc sách",
        NotificationManager.IMPORTANCE_LOW,
      ).apply { setShowBadge(false) }
      mgr.createNotificationChannel(channel)
    }
  }

  private fun servicePending(action: String): PendingIntent {
    val intent = Intent(this, TtsForegroundService::class.java).setAction(action)
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      PendingIntent.getForegroundService(this, action.hashCode(), intent, flags)
    } else {
      PendingIntent.getService(this, action.hashCode(), intent, flags)
    }
  }

  private fun launchAppPending(): PendingIntent {
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    return PendingIntent.getActivity(this, 0, launch, flags)
  }

  // --- Audio focus -----------------------------------------------------------

  private fun requestFocus() {
    val attrs = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_MEDIA)
      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
      .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        .setAudioAttributes(attrs)
        .setWillPauseWhenDucked(false)
        .build()
      focusRequest = req
      audioManager.requestAudioFocus(req)
    } else {
      @Suppress("DEPRECATION")
      audioManager.requestAudioFocus(
        null,
        AudioManager.STREAM_MUSIC,
        AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK,
      )
    }
  }

  private fun abandonFocus() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
      focusRequest = null
    } else {
      @Suppress("DEPRECATION")
      audioManager.abandonAudioFocus(null)
    }
  }

  override fun onDestroy() {
    main.removeCallbacks(idleStop)
    abandonFocus()
    if (::tts.isInitialized) tts.shutdown()
    if (::mediaSession.isInitialized) mediaSession.release()
    super.onDestroy()
  }

  private fun idOf(utteranceId: String?): Int? =
    utteranceId?.takeIf { it.startsWith(UTT_PREFIX) }?.removePrefix(UTT_PREFIX)?.toIntOrNull()

  companion object {
    const val ACTION_SPEAK = "expo.modules.pockettts.SPEAK"
    const val ACTION_PAUSE = "expo.modules.pockettts.PAUSE"
    const val ACTION_RESUME = "expo.modules.pockettts.RESUME"
    const val ACTION_STOP = "expo.modules.pockettts.STOP"
    const val ACTION_NOWPLAYING = "expo.modules.pockettts.NOWPLAYING"
    const val ACTION_REMOTE_NEXT = "expo.modules.pockettts.REMOTE_NEXT"
    const val ACTION_REMOTE_PREV = "expo.modules.pockettts.REMOTE_PREV"

    const val EXTRA_CHUNKS = "chunks"
    const val EXTRA_SEGMENTS = "segments"
    const val EXTRA_START_SEGMENT = "startSegment"
    const val EXTRA_RATE = "rate"
    const val EXTRA_PITCH = "pitch"
    const val EXTRA_VOICE = "voice"
    const val EXTRA_TITLE = "title"
    const val EXTRA_CHAPTER = "chapter"

    private const val CHANNEL_ID = "pocket_tts_playback"
    private const val NOTIF_ID = 0xB00C
    private const val UTT_PREFIX = "u"
    private const val IDLE_STOP_MS = 1500L
  }
}
