package com.faizmuna.journal.widget

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import kotlin.concurrent.thread

/**
 * Setup: the family password once, then whose Next Move this phone shows.
 * The password is sent to Firebase sign-in and forgotten; only the refresh token is kept (see Store).
 */
class SetupActivity : Activity() {
    private lateinit var s: Store
    private lateinit var box: LinearLayout
    private val dp get() = resources.displayMetrics.density

    override fun onCreate(saved: Bundle?) {
        super.onCreate(saved)
        s = Store(this)
        box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(px(24), px(40), px(24), px(24))
        }
        setContentView(ScrollView(this).apply { setBackgroundColor(BG); addView(box) })
        show()
    }

    private fun px(v: Int) = (v * dp).toInt()

    private fun show() {
        box.removeAllViews()
        heading("Next Move widget")
        addWidgetOffer()
        when {
            !s.signedIn -> signInForm()
            s.person == null -> pickPerson()
            else -> done()
        }
    }

    private fun signInForm() {
        text(if (s.person != null) "The saved sign-in stopped working. Type the family password again." else
            "Shows your \"Your next move\" from the journal on the home screen. Type the family password to start.")
        val pass = EditText(this).apply {
            hint = "Family password"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            typeface = android.graphics.Typeface.DEFAULT // password fields are monospace otherwise
            imeOptions = EditorInfo.IME_ACTION_DONE
            setTextColor(INK); setHintTextColor(MUTED)
        }
        box.addView(pass, LinearLayout.LayoutParams(-1, -2).apply { topMargin = px(16) })
        val msg = text("")
        val go = button("Sign in", primary = true) {}
        val submit = {
            val pw = pass.text.toString()
            if (pw.isEmpty()) msg.text = "Type the password first."
            else {
                go.isEnabled = false; msg.text = "Signing in…"
                thread {
                    val err = try { Api.signIn(s, pw); null }
                    catch (e: Api.WrongPassword) { "That password didn't work." }
                    catch (e: Exception) { "Couldn't sign in. Check your connection and try again." }
                    runOnUiThread {
                        if (err == null) show() else { msg.text = err; go.isEnabled = true }
                    }
                }
            }
        }
        go.setOnClickListener { submit() }
        pass.setOnEditorActionListener { _, id, _ -> if (id == EditorInfo.IME_ACTION_DONE) { submit(); true } else false }
    }

    private fun pickPerson() {
        text("Whose next move should this phone show?")
        val msg = text("Loading names…")
        thread {
            val people = try { Api.people(s) } catch (e: Api.SignedOut) { null } catch (e: Exception) { emptyList() }
            runOnUiThread {
                if (people == null) { show(); return@runOnUiThread }
                msg.text = if (people.isEmpty()) "Couldn't load the names. Check your connection." else ""
                if (people.isEmpty()) button("Try again") { show() }
                for ((id, name) in people) button(name, primary = true) {
                    s.person = id; s.personName = name; s.lastMove = null
                    MoveWidget.requestRefresh(this)
                    show()
                }
            }
        }
    }

    private fun done() {
        text("This phone shows ${s.personName ?: "your"}'s next move.")
        if (placed()) text("The widget is on your home screen. It refreshes every 30 minutes, or tap ↻ on it.")
        button("Refresh now") { MoveWidget.requestRefresh(this) }
        button("Change person") { s.person = null; s.lastMove = null; MoveWidget.requestRefresh(this); show() }
        button("Sign out") { s.signOut(); s.person = null; MoveWidget.requestRefresh(this); show() }
    }

    private fun placed() = getSystemService(AppWidgetManager::class.java)
        .getAppWidgetIds(ComponentName(this, MoveWidget::class.java)).isNotEmpty()

    /** Shown on every screen until the widget is placed: some phones' widget lists hide it or it's hard to find. */
    private fun addWidgetOffer() {
        if (placed()) return
        val mgr = getSystemService(AppWidgetManager::class.java)
        if (mgr.isRequestPinAppWidgetSupported) {
            button("Add widget to home screen", primary = true) {
                mgr.requestPinAppWidget(ComponentName(this, MoveWidget::class.java), null, null)
            }
            text("Nothing happened? Open this app's settings and allow home screen shortcuts (Xiaomi, Vivo and Oppo phones block it at first), then try again.")
        }
        text("Or: touch and hold an empty spot on the home screen, tap Widgets, and look for Next Move.")
    }

    override fun onResume() {
        super.onResume()
        if (::box.isInitialized) show() // e.g. back after placing the widget
    }

    // ---------- small view helpers ----------
    private fun heading(t: String) = TextView(this).apply {
        text = t; textSize = 24f; setTextColor(INK); setTypeface(typeface, android.graphics.Typeface.BOLD)
        box.addView(this)
    }

    private fun text(t: String) = TextView(this).apply {
        text = t; textSize = 16f; setTextColor(MUTED); setLineSpacing(0f, 1.2f)
        visibility = if (t.isEmpty()) View.INVISIBLE else View.VISIBLE
        box.addView(this, LinearLayout.LayoutParams(-1, -2).apply { topMargin = px(12) })
    }.also { tv -> tv.addTextChangedListener(object : android.text.TextWatcher {
        override fun afterTextChanged(e: android.text.Editable?) { tv.visibility = if (e.isNullOrEmpty()) View.INVISIBLE else View.VISIBLE }
        override fun beforeTextChanged(a: CharSequence?, b: Int, c: Int, d: Int) {}
        override fun onTextChanged(a: CharSequence?, b: Int, c: Int, d: Int) {}
    }) }

    private fun button(t: String, primary: Boolean = false, onClick: () -> Unit) = Button(this).apply {
        text = t; isAllCaps = false; textSize = 16f; gravity = Gravity.CENTER
        setTextColor(if (primary) BG else INK)
        background = GradientDrawable().apply { cornerRadius = 12 * dp; setColor(if (primary) ACCENT else SURFACE) }
        setOnClickListener { onClick() }
        box.addView(this, LinearLayout.LayoutParams(-1, px(52)).apply { topMargin = px(12) })
    }

    companion object {
        // Same as the journal's dark theme (public/styles.css).
        private val BG = Color.parseColor("#11141e")
        private val SURFACE = Color.parseColor("#1a1f2e")
        private val INK = Color.parseColor("#e9ecf6")
        private val MUTED = Color.parseColor("#a0a8c0")
        private val ACCENT = Color.parseColor("#93a5ff")
    }
}
