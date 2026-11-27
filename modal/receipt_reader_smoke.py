"""Run in CI against Gemini using a synthetic, image-only PDF."""
import io
import os

import modal

app = modal.App("receipt-reader-smoke")
image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "pillow==11.3.0", "requests==2.32.3"
).add_local_file("modal/receipt_reader.py", "/root/receipt_reader.py")


@app.function(image=image, secrets=[modal.Secret.from_name("gemini")], timeout=120)
def check_payslip():
    from PIL import Image, ImageDraw, ImageFont
    from receipt_reader import PAYSLIP_MODEL, PAYSLIP_PROMPT, PAYSLIP_SCHEMA, ask_gemini

    scan = Image.new("RGB", (1200, 850), "white")
    draw = ImageDraw.Draw(scan)
    font = ImageFont.load_default(size=46)
    for index, line in enumerate((
        "FICTIONAL PAYSLIP - TEST ONLY",
        "Employer: Example Services Sdn Bhd",
        "Pay date: 27/11/2026",
        "Gross pay: RM 1500.00",
        "Net pay: RM 1234.56",
    )):
        draw.text((60, 65 + index * 92), line, font=font, fill="black")
    with io.BytesIO() as buffer:
        scan.save(buffer, format="PDF")
        result = ask_gemini(
            buffer.getvalue(),
            os.environ.get("GEMINI_PAYSLIP_MODEL", PAYSLIP_MODEL),
            os.environ["GEMINI_API_KEY"],
            "application/pdf",
            PAYSLIP_PROMPT,
            PAYSLIP_SCHEMA,
        )
    assert result.get("net_pay_sen") == 123456, "Gemini did not extract synthetic net pay"
    assert result.get("payment_date") == "2026-11-27", "Gemini did not extract synthetic pay date"
    assert "Example Services" in (result.get("employer") or ""), "Gemini did not extract synthetic employer"
    print("Gemini read all three fields from a synthetic scanned PDF.")
