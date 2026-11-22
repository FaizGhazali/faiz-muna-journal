package com.faizmuna.journal.widget

import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * Talks to Firebase over plain REST (no Firebase SDK). The API key and project id are read at run time from the
 * site's /__/firebase/init.json, so no keys live in the repo.
 */
object Api {
    const val SITE = "https://faiz-muna-journal-c43ab.web.app/"
    private const val FAMILY_EMAIL = "family@journal.invalid" // same constant as FAMILY_EMAIL in public/app.js

    /** The saved sign-in no longer works (password changed, token revoked): the person has to sign in again. */
    class SignedOut : Exception("Signed out")
    class WrongPassword : Exception("Wrong password")

    private fun http(url: String, method: String = "GET", body: String? = null,
                     type: String = "application/json", bearer: String? = null): Pair<Int, String> {
        val c = URL(url).openConnection() as HttpURLConnection
        try {
            c.connectTimeout = 10_000
            c.readTimeout = 10_000
            c.requestMethod = method
            c.setRequestProperty("Referer", SITE) // in case the API key is limited to the site
            if (bearer != null) c.setRequestProperty("Authorization", "Bearer $bearer")
            if (body != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", type)
                c.outputStream.use { it.write(body.toByteArray()) }
            }
            val code = c.responseCode
            val text = (if (code < 400) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            return code to text
        } finally {
            c.disconnect()
        }
    }

    private fun errorOf(text: String): String =
        runCatching { JSONObject(text).getJSONObject("error").getString("message") }.getOrDefault(text.take(120))

    private fun config(s: Store): Pair<String, String> {
        val k = s.apiKey
        val id = s.projectId
        if (k != null && id != null) return k to id
        val (code, text) = http(SITE + "__/firebase/init.json")
        if (code != 200) throw IOException("Couldn't reach the journal ($code)")
        val j = JSONObject(text)
        s.apiKey = j.getString("apiKey")
        s.projectId = j.getString("projectId")
        return j.getString("apiKey") to j.getString("projectId")
    }

    private fun saveTokens(s: Store, id: String, refresh: String, expiresIn: String) {
        s.refreshToken = refresh
        s.idToken = id
        s.idExpires = System.currentTimeMillis() + (expiresIn.toLongOrNull() ?: 3600) * 1000 - 60_000
    }

    fun signIn(s: Store, password: String) {
        val (key, _) = config(s)
        val body = JSONObject().put("email", FAMILY_EMAIL).put("password", password).put("returnSecureToken", true)
        val (code, text) = http("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=$key", "POST", body.toString())
        if (code != 200) {
            val m = errorOf(text)
            if (m.startsWith("INVALID_PASSWORD") || m.startsWith("INVALID_LOGIN_CREDENTIALS") || m.startsWith("EMAIL_NOT_FOUND")) throw WrongPassword()
            throw IOException(m)
        }
        val j = JSONObject(text)
        saveTokens(s, j.getString("idToken"), j.getString("refreshToken"), j.optString("expiresIn"))
    }

    private fun token(s: Store, fresh: Boolean = false): String {
        val cached = s.idToken
        if (!fresh && cached != null && System.currentTimeMillis() < s.idExpires) return cached
        val rt = s.refreshToken ?: throw SignedOut()
        val (key, _) = config(s)
        val (code, text) = http("https://securetoken.googleapis.com/v1/token?key=$key", "POST",
            "grant_type=refresh_token&refresh_token=" + URLEncoder.encode(rt, "UTF-8"), "application/x-www-form-urlencoded")
        if (code == 400) { s.signOut(); throw SignedOut() } // TOKEN_EXPIRED, INVALID_REFRESH_TOKEN, USER_DISABLED ...
        if (code != 200) throw IOException(errorOf(text))
        val j = JSONObject(text)
        saveTokens(s, j.getString("id_token"), j.getString("refresh_token"), j.optString("expires_in"))
        return j.getString("id_token")
    }

    /** A Firestore document's fields, or null when it doesn't exist. */
    private fun doc(s: Store, path: String): JSONObject? {
        val (_, project) = config(s)
        val url = "https://firestore.googleapis.com/v1/projects/$project/databases/(default)/documents/$path"
        var (code, text) = http(url, bearer = token(s))
        if (code == 401) http(url, bearer = token(s, fresh = true)).let { code = it.first; text = it.second }
        if (code == 404) return null
        if (code != 200) throw IOException("Firestore: ${errorOf(text)}")
        return JSONObject(text).optJSONObject("fields") ?: JSONObject()
    }

    private fun JSONObject.str(k: String): String? = optJSONObject(k)?.let { if (it.has("stringValue")) it.getString("stringValue") else null }

    /** config/people → [(id, name)], so the setup screen shows the names chosen in the app. */
    fun people(s: Store): List<Pair<String, String>> {
        val list = doc(s, "config/people")?.optJSONObject("people")?.optJSONObject("arrayValue")?.optJSONArray("values")
            ?: return emptyList()
        return (0 until list.length()).mapNotNull { i ->
            val f = list.getJSONObject(i).optJSONObject("mapValue")?.optJSONObject("fields") ?: return@mapNotNull null
            val id = f.str("id") ?: return@mapNotNull null
            id to (f.str("name") ?: id)
        }
    }

    /** nextMove/{person}, written by public/activities.js (publishMoves). */
    fun nextMove(s: Store, person: String): Move? {
        val f = doc(s, "nextMove/$person") ?: return null
        return Move(f.str("title"), f.str("type"), f.str("why") ?: "", f.str("date") ?: "")
    }
}
