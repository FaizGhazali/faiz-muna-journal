package com.faizmuna.journal.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import kotlin.concurrent.thread

/**
 * The home-screen card: "Your next move", the title and the reason line, exactly as the journal shows them.
 * Refreshes every 30 minutes (updatePeriodMillis) and when ↻ is tapped. Tapping the card opens the journal at #next.
 * The receipt button opens ScanActivity (scan a shop receipt for Stocky).
 */
class MoveWidget : AppWidgetProvider() {

    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) = refresh(ctx, goAsync())

    override fun onReceive(ctx: Context, intent: Intent) {
        super.onReceive(ctx, intent)
        if (intent.action == ACTION_REFRESH) {
            draw(ctx, busy = true)
            refresh(ctx, goAsync())
        }
    }

    companion object {
        const val ACTION_REFRESH = "com.faizmuna.journal.widget.REFRESH"
        private val TYPES = mapOf("skill" to "Skill", "task" to "One-time task", "explore" to "Explore", "cook" to "Cooking", "habit" to "Habit")

        /** Ask the widget(s) to fetch again, e.g. after setup. */
        fun requestRefresh(ctx: Context) =
            ctx.sendBroadcast(Intent(ctx, MoveWidget::class.java).setAction(ACTION_REFRESH))

        private fun refresh(ctx: Context, pending: PendingResult?) {
            val s = Store(ctx)
            thread {
                try {
                    val person = s.person
                    if (s.ready && person != null) {
                        s.lastMove = Api.nextMove(s, person) ?: Move(null, null, "Open the journal once to start.", "")
                        s.lastError = null
                    }
                } catch (e: Api.SignedOut) {
                    s.lastError = null // draw() shows "Tap to sign in again"
                } catch (e: Exception) {
                    s.lastError = "Couldn't refresh"
                } finally {
                    draw(ctx)
                    pending?.finish()
                }
            }
        }

        private fun draw(ctx: Context, busy: Boolean = false) {
            val mgr = AppWidgetManager.getInstance(ctx)
            val ids = mgr.getAppWidgetIds(ComponentName(ctx, MoveWidget::class.java))
            if (ids.isEmpty()) return
            val s = Store(ctx)
            val v = RemoteViews(ctx.packageName, R.layout.widget_move)
            val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT

            if (!s.ready) {
                v.setTextViewText(R.id.eyebrow, "YOUR NEXT MOVE")
                v.setTextViewText(R.id.title, if (s.signedIn) "Pick who this is for" else if (s.person != null) "Tap to sign in again" else "Tap to set up")
                v.setTextViewText(R.id.why, "Sign in with the family password and choose your name.")
                v.setViewVisibility(R.id.status, View.GONE)
                v.setOnClickPendingIntent(R.id.root, PendingIntent.getActivity(ctx, 1, Intent(ctx, SetupActivity::class.java), flags))
            } else {
                val m = s.lastMove
                val type = m?.type?.let { TYPES[it] }
                v.setTextViewText(R.id.eyebrow, listOfNotNull("YOUR NEXT MOVE", type?.uppercase()).joinToString(" · "))
                when {
                    m == null -> { v.setTextViewText(R.id.title, "Loading…"); v.setTextViewText(R.id.why, "") }
                    m.title == null -> { v.setTextViewText(R.id.title, m.why.ifEmpty { "Nothing planned" }); v.setTextViewText(R.id.why, "Tap to open the journal.") }
                    else -> { v.setTextViewText(R.id.title, m.title); v.setTextViewText(R.id.why, m.why) }
                }
                v.setViewVisibility(R.id.why, if (m?.let { it.title != null && it.why.isEmpty() } == true) View.GONE else View.VISIBLE)
                val status = listOfNotNull(if (busy) "Refreshing…" else s.lastError, m?.let { age(it.date) }).joinToString(" · ")
                v.setTextViewText(R.id.status, status)
                v.setViewVisibility(R.id.status, if (status.isEmpty()) View.GONE else View.VISIBLE)
                // Opens the installed journal app (the PWA) at the Next Move card.
                val open = Intent(Intent.ACTION_VIEW, Uri.parse(Api.SITE + "#next")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                v.setOnClickPendingIntent(R.id.root, PendingIntent.getActivity(ctx, 2, open, flags))
            }
            // Scan a receipt for Stocky, straight from the home screen (no sign-in needed: the journal saves it).
            val scan = Intent(ctx, ScanActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            v.setOnClickPendingIntent(R.id.scan, PendingIntent.getActivity(ctx, 4, scan, flags))
            val again = Intent(ctx, MoveWidget::class.java).setAction(ACTION_REFRESH)
            v.setOnClickPendingIntent(R.id.refresh, PendingIntent.getBroadcast(ctx, 3, again, flags))
            mgr.updateAppWidget(ids, v)
        }

        /** "" for today, "From yesterday", or "From 3 Nov" when the journal hasn't been opened since. */
        private fun age(date: String): String? {
            val d = runCatching { LocalDate.parse(date) }.getOrNull() ?: return null
            val today = LocalDate.now()
            return when {
                !d.isBefore(today) -> null
                d == today.minusDays(1) -> "From yesterday"
                else -> "From " + d.format(DateTimeFormatter.ofPattern("d MMM"))
            }
        }
    }
}
