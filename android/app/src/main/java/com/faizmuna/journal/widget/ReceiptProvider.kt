package com.faizmuna.journal.widget

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import java.io.File
import java.io.FileNotFoundException

/**
 * Hands the last scanned receipt (one JPEG in the app's cache) to the journal app, read-only and only to the app it
 * was shared with (FLAG_GRANT_READ_URI_PERMISSION). A tiny stand-in for AndroidX's FileProvider, so the app's own
 * code still uses no AndroidX.
 */
class ReceiptProvider : ContentProvider() {
    companion object {
        private const val NAME = "receipt.jpg"
        fun file(ctx: Context) = File(ctx.cacheDir, NAME)
        fun uri(ctx: Context): Uri = Uri.parse("content://${ctx.packageName}.receipt/$NAME")
    }

    override fun onCreate() = true
    override fun getType(uri: Uri) = "image/jpeg"

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        val f = file(context!!)
        if (uri.lastPathSegment != NAME || mode != "r" || !f.exists()) throw FileNotFoundException()
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY)
    }

    // Name and size, for apps that ask before reading.
    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, args: Array<out String>?, sort: String?): Cursor {
        val c = MatrixCursor(arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE))
        c.addRow(arrayOf<Any>(NAME, file(context!!).length()))
        return c
    }

    override fun insert(uri: Uri, values: ContentValues?): Uri? = throw UnsupportedOperationException()
    override fun update(uri: Uri, values: ContentValues?, selection: String?, args: Array<out String>?) = 0
    override fun delete(uri: Uri, selection: String?, args: Array<out String>?) = 0
}
