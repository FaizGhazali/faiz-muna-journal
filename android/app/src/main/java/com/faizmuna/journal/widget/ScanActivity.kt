package com.faizmuna.journal.widget

import android.app.Activity
import android.app.AlertDialog
import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult

/**
 * Scan a shop receipt for Stocky. Opened by the journal's "Scan receipt" button (journalscan://scan, through an
 * intent:// link) or the widget's receipt button. Runs Google's ML Kit document scanner (crop, straighten, clean up;
 * no camera permission; one page; a gallery picture works too), then shares the JPEG straight to the installed
 * journal app (its share_target), which reads it at #stocky/scan. Nothing is kept here: the picture is overwritten
 * by the next scan. Plan: docs/receipt-scan-plan.md.
 */
class ScanActivity : Activity() {

    override fun onCreate(saved: Bundle?) {
        super.onCreate(saved)
        if (saved != null) return // coming back after a rotation: the scanner's answer arrives in onActivityResult
        val options = GmsDocumentScannerOptions.Builder()
            .setGalleryImportAllowed(true)
            .setPageLimit(1)
            .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
            .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
            .build()
        GmsDocumentScanning.getClient(options).getStartScanIntent(this)
            .addOnSuccessListener { sender ->
                try {
                    startIntentSenderForResult(sender, SCAN, null, 0, 0, 0)
                } catch (e: Exception) {
                    tell("The scanner couldn't open. Try again in a moment.")
                }
            }
            .addOnFailureListener {
                tell("The scanner needs Google Play services, and downloads its parts the first time. Check the internet and try again.")
            }
    }

    @Deprecated("Plain Activity result API: this app uses no AndroidX.")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != SCAN) return
        val page = if (resultCode == RESULT_OK) GmsDocumentScanningResult.fromActivityResultIntent(data)?.pages?.firstOrNull() else null
        if (page == null) { finish(); return } // cancelled
        try {
            contentResolver.openInputStream(page.imageUri)!!.use { input ->
                ReceiptProvider.file(this).outputStream().use { input.copyTo(it) }
            }
        } catch (e: Exception) {
            tell("The scanned picture couldn't be saved. Try again.")
            return
        }
        send()
    }

    /** Share the picture to the installed journal (its WebAPK), or say how to get it. */
    private fun send() {
        val uri = ReceiptProvider.uri(this)
        val share = Intent(Intent.ACTION_SEND)
            .setType("image/jpeg")
            .putExtra(Intent.EXTRA_STREAM, uri)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        share.clipData = ClipData.newRawUri("receipt", uri)
        val pkg = journalPackage()
        if (pkg != null) {
            startActivity(share.setPackage(pkg).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            finish()
            return
        }
        AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("Journal app not found")
            .setMessage("To send receipts straight to Stocky, open the journal in Chrome and tap Install app (or Add to Home screen), then scan again. If you just installed it, give Chrome a few minutes. You can also share the picture yourself.")
            .setPositiveButton("Share…") { _, _ -> startActivity(Intent.createChooser(share, "Send the receipt to")); finish() }
            .setNegativeButton("OK") { _, _ -> finish() }
            .setOnCancelListener { finish() }
            .show()
    }

    /** The installed journal app: a Chrome WebAPK that opens the journal's site and takes shared pictures. */
    private fun journalPackage(): String? {
        val pm = packageManager
        @Suppress("DEPRECATION")
        val opensSite = pm.queryIntentActivities(Intent(Intent.ACTION_VIEW, Uri.parse(Api.SITE)), PackageManager.MATCH_ALL)
            .map { it.activityInfo.packageName }.filter { it.startsWith("org.chromium.webapk") }.toSet()
        @Suppress("DEPRECATION")
        return pm.queryIntentActivities(Intent(Intent.ACTION_SEND).setType("image/jpeg"), PackageManager.MATCH_ALL)
            .map { it.activityInfo.packageName }.firstOrNull { it in opensSite }
    }

    private fun tell(text: String) {
        AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setMessage(text)
            .setPositiveButton("OK") { _, _ -> finish() }
            .setOnCancelListener { finish() }
            .show()
    }

    companion object {
        private const val SCAN = 7
    }
}
