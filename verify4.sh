#!/usr/bin/env bash
# Verify: owner uploads a logo in settings → it shows in the admin sidebar + QR menu header.
set +e
cd /home/z/my-project

LOG=/home/z/my-project/verify4.log; : > "$LOG"; SHOTS=/home/z/my-project/verify4-shots
mkdir -p "$SHOTS"
ev() { agent-browser eval "(()=>{ $1 })()" 2>&1 | tail -2 >> "$LOG"; }
shot() { agent-browser screenshot "$SHOTS/$1.png" --full 2>&1 | tail -1 >> "$LOG"; }

agent-browser close 2>/dev/null
agent-browser set viewport 1280 800 >/dev/null 2>&1

# ---- 1. Login as owner ----
agent-browser open "http://localhost:3000/" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1; sleep 3
ev 'const ins=Array.from(document.querySelectorAll("input")); let e,p; ins.forEach(i=>{if(i.type==="email"||i.placeholder?.toLowerCase().includes("email"))e=i; if(i.type==="password")p=i}); const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set; if(e){s.call(e,"owner@spicegarden.in"); e.dispatchEvent(new Event("input",{bubbles:true}))} if(p){s.call(p,"password123"); p.dispatchEvent(new Event("input",{bubbles:true}))} return "filled"'
sleep 1
ev 'const f=document.querySelector("form"); if(f){f.requestSubmit(); return "submitted"} return "NO FORM"'
sleep 4
ev 'return "logged-in hash=" + window.location.hash'
shot 01-logged-in

# ---- 2. Check sidebar BEFORE logo upload (should show QrCode icon) ----
log_step() { echo -e "\n===== $1 =====" >> "$LOG"; }
log_step "SIDEBAR BEFORE LOGO UPLOAD"
# The sidebar brand area: check for img vs QrCode svg
ev 'const brand=document.querySelector("aside div.flex.h-9"); const img=brand?.querySelector("img"); return "sidebar-has-img: " + !!img + " | sidebar-has-svg: " + !!brand?.querySelector("svg")'
shot 02-sidebar-before

# ---- 3. Navigate to Settings → Restaurant tab ----
log_step "NAVIGATE TO SETTINGS"
ev 'window.location.hash = "settings"'
sleep 3
ev 'const t=Array.from(document.querySelectorAll("[role=tab], button")).find(b=>b.textContent.includes("Restaurant")); if(t){t.click(); return "restaurant tab clicked"} return "NO TAB"'
sleep 2
shot 03-settings-restaurant-tab

# ---- 4. Find the logo uploader and upload a test image ----
log_step "UPLOAD LOGO"
# Check the ImageUploader is present
ev 'return "has-logo-uploader: " + document.body.textContent.includes("Restaurant logo")'
# We need to upload a file via the hidden file input. Use agent-browser upload command.
# First find the file input
ev 'const inp=document.querySelector("input[type=file]"); return "file-input-found: " + !!inp'
# Generate a small test PNG and upload it
env -u DATABASE_URL bun -e '
const fs = require("fs");
// Minimal 1x1 red PNG (base64)
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==", "base64");
fs.writeFileSync("/tmp/test-logo.png", png);
console.log("wrote test-logo.png");
' 2>&1 | grep -E "wrote|error" | head
# Upload via the file input
agent-browser upload 'input[type=file]' /tmp/test-logo.png 2>&1 | tail -2 >> "$LOG"
sleep 3
shot 04-logo-uploaded
# Check if the upload succeeded (the ImageUploader should now show the preview)
ev 'const inp=document.querySelector("input[type=file]"); const brand=document.querySelector("aside div.flex.h-9"); return "upload-state: logo-field=" + document.body.textContent.includes("Logo uploaded")'

# ---- 5. Save settings ----
log_step "SAVE SETTINGS"
ev 'const b=Array.from(document.querySelectorAll("button")).find(x=>x.textContent.includes("Save")||x.textContent.includes("save")); if(b){b.click(); return "clicked save"} return "NO SAVE BTN"'
sleep 3
shot 05-saved

# ---- 6. Verify logo shows in sidebar ----
log_step "SIDEBAR AFTER LOGO UPLOAD"
ev 'const brand=document.querySelector("aside div.flex.h-9"); const img=brand?.querySelector("img"); return "sidebar-has-img: " + !!img + " | src=" + (img?.src||"none")'
shot 06-sidebar-after

# ---- 7. Verify DB has logo URL ----
log_step "DB CHECK: LOGO SAVED"
env -u DATABASE_URL bun -e '
import { db } from "./src/lib/db"
const r = await db.restaurant.findFirst({ where: { slug: "spice-garden" }, select: { logo: true } })
console.log("DB logo: " + (r?.logo || "NONE"))
await db.$disconnect()
' 2>&1 | grep -E "DB logo" >> "$LOG"

# ---- 8. Check QR menu page shows the logo ----
log_step "QR MENU LOGO CHECK"
# Open the customer menu in a new tab using the table token
agent-browser open "http://localhost:3000/?table=sg-1-fz99au3rwz" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1; sleep 3
shot 07-qr-menu
ev 'const header=document.querySelector("header"); const img=header?.querySelector("img"); return "qr-menu-has-logo-img: " + !!img + " | src=" + (img?.src||"none") + " | alt=" + (img?.alt||"none")'

log_step "PAGE ERRORS"
agent-browser errors 2>&1 | tail -5 >> "$LOG"
echo -e "\n========== RESULT ==========" >> "$LOG"
tail -50 "$LOG"
