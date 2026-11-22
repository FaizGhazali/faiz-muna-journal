package com.faizmuna.journal.widget

import android.content.Context
import org.json.JSONObject

/** One person's pick, as the web app published it to nextMove/{person}. title == null: nothing to suggest. */
data class Move(val title: String?, val type: String?, val why: String, val date: String) {
    fun toJson(): String = JSONObject().put("title", title ?: JSONObject.NULL).put("type", type ?: JSONObject.NULL)
        .put("why", why).put("date", date).toString()

    companion object {
        fun fromJson(s: String?): Move? = s?.let {
            runCatching {
                val j = JSONObject(it)
                Move(j.optStringOrNull("title"), j.optStringOrNull("type"), j.optString("why"), j.optString("date"))
            }.getOrNull()
        }
    }
}

fun JSONObject.optStringOrNull(k: String): String? = if (isNull(k)) null else optString(k)

/**
 * Everything the widget keeps on the phone. Only the refresh token is stored, never the family password.
 * (allowBackup is off, so none of this goes into a phone backup.)
 */
class Store(ctx: Context) {
    private val p = ctx.applicationContext.getSharedPreferences("widget", Context.MODE_PRIVATE)

    var apiKey: String? by pref("apiKey")
    var projectId: String? by pref("projectId")
    var refreshToken: String? by pref("refreshToken")
    var idToken: String? by pref("idToken")
    var idExpires: Long
        get() = p.getLong("idExpires", 0)
        set(v) = p.edit().putLong("idExpires", v).apply()
    var person: String? by pref("person")         // "p1" | "p2"
    var personName: String? by pref("personName")
    var lastMove: Move?
        get() = Move.fromJson(p.getString("lastMove", null))
        set(v) = p.edit().putString("lastMove", v?.toJson()).apply()
    var lastError: String? by pref("lastError")   // shown small on the widget when a refresh failed

    val signedIn get() = refreshToken != null
    val ready get() = signedIn && person != null

    fun signOut() {
        p.edit().remove("refreshToken").remove("idToken").remove("idExpires").remove("lastMove").remove("lastError").apply()
    }

    private fun pref(key: String) = object : kotlin.properties.ReadWriteProperty<Any?, String?> {
        override fun getValue(thisRef: Any?, property: kotlin.reflect.KProperty<*>) = p.getString(key, null)
        override fun setValue(thisRef: Any?, property: kotlin.reflect.KProperty<*>, value: String?) {
            p.edit().putString(key, value).apply()
        }
    }
}
