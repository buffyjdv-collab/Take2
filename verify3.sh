#!/usr/bin/env bash
# Verify: tenant pays platform fees by CASH → super admin confirms → fees collected.
set +e
cd /home/z/my-project

LOG=/home/z/my-project/verify3-result.log
SHOTS=/home/z/my-project/verify3-shots
mkdir -p "$SHOTS"
: > "$LOG"
log() { echo -e "\n===== $* =====" >> "$LOG"; }
ev() { agent-browser eval "(()=>{ $1 })()" 2>&1 | tail -2 >> "$LOG"; }
shot() { agent-browser screenshot "$SHOTS/$1.png" --full 2>&1 | tail -1 >> "$LOG"; }

# ---- 1. Start services ----
log "STARTING SERVICES"
env -u DATABASE_URL bash -c 'cd /home/z/my-project/mini-services/realtime-service && setsid bun run dev </dev/null >/home/z/my-project/realtime.log 2>&1 & disown'
env -u DATABASE_URL bash -c 'cd /home/z/my-project && setsid bun run dev </dev/null >/dev/null 2>&1 & disown'
for i in $(seq 1 40); do
  [ "$(curl -s -m 3 -o /dev/null -w '%{http_code}' "http://localhost:3000/api/customer/menu?table=sg-1-fz99au3rwz" 2>/dev/null)" = "200" ] && break
  sleep 1
done
echo "dev ready" >> "$LOG"

# ---- helper: login via the landing page form ----
do_login() {
  local email="$1"
  agent-browser open "http://localhost:3000/" >/dev/null 2>&1
  agent-browser wait --load networkidle >/dev/null 2>&1
  sleep 2
  # Fill email + password
  ev 'const ins=document.querySelectorAll("input"); let e,p; ins.forEach(i=>{if(i.type==="email"||i.name==="email"||i.placeholder?.toLowerCase().includes("email"))e=i; if(i.type==="password")p=i}); const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set; if(e){s.call(e,"'"$email"'"); e.dispatchEvent(new Event("input",{bubbles:true}))} if(p){s.call(p,"password123"); p.dispatchEvent(new Event("input",{bubbles:true}))} return "email="+(e?e.value:"NONE")+" pwd="+(p?"set":"NONE")'
  sleep 1
  # Click the sign-in submit button
  ev 'const btn=Array.from(document.querySelectorAll("button")).find(b=>b.type==="submit"||b.textContent.toLowerCase().includes("sign in")); if(btn){btn.click(); return "clicked sign-in"} return "NO SUBMIT"'
  sleep 3
}

# ---- 2. Login as restaurant OWNER ----
log "LOGIN AS OWNER"
agent-browser set viewport 1280 800 >/dev/null 2>&1
do_login "owner@spicegarden.in"
shot 01-owner-logged-in
ev 'return "url=" + window.location.hash + " | body has Settings: " + document.body.textContent.includes("Settings")'

# ---- 3. Navigate to Settings → Platform fees tab ----
log "NAVIGATE TO SETTINGS > PLATFORM FEES"
ev 'window.location.hash = "settings"'
sleep 2
shot 02-settings-page
ev 'const t=Array.from(document.querySelectorAll("[role=tab], button")).find(b=>b.textContent.includes("Platform fees")); if(t){t.click(); return "clicked platform-fees tab"} return "NO TAB"'
sleep 2
shot 03-platform-fees-panel
ev 'const t=document.body.textContent; return "outstanding:" + (t.match(/₹[\d,.]+/)?.[0]||"NONE") + " | has Pay now: " + (t.includes("Pay")||t.includes("pay"))'

# ---- 4. Click "Pay now" → opens payment sheet ----
log "CLICK PAY NOW"
ev 'const b=Array.from(document.querySelectorAll("button")).find(x=>x.textContent.includes("Pay") && (x.textContent.includes("now")||x.textContent.includes("₹"))); if(b){b.click(); return "clicked pay: "+b.textContent.trim().slice(0,30)} return "NO PAY BTN"'
sleep 2
shot 04-payment-methods-sheet
# Verify Cash option is present
ev 'return "cash-option-present: " + document.body.textContent.includes("Cash")'

# ---- 5. Select CASH ----
log "SELECT CASH"
ev 'const b=Array.from(document.querySelectorAll("button,[role=option],[role=radio],div,li")).find(x=>x.textContent.includes("Cash") && x.textContent.length<60); if(b){b.click(); return "clicked cash"} return "NO CASH OPTION"'
sleep 1
shot 05-cash-selected

# ---- 6. Confirm the payment (click Pay ₹X) ----
log "CONFIRM CASH PAYMENT"
ev 'const b=Array.from(document.querySelectorAll("button")).find(x=>/^Pay ₹/.test(x.textContent.trim())); if(b){b.click(); return "clicked pay: "+b.textContent.trim()} return "NO PAY CTA"'
sleep 3
shot 06-after-cash-pay
# Check for the "Cash payment recorded" toast / awaiting confirmation
ev 'const t=document.body.textContent; return "awaiting-confirm: " + (t.includes("Cash")||t.includes("awaiting")||t.includes("confirm")) + " | toast-present: " + (!!document.querySelector("[data-sonner-toast]"))'

# ---- 7. Verify DB: a PROCESSING CASH payment was created ----
log "DB CHECK: PROCESSING CASH PAYMENT"
env -u DATABASE_URL bun -e '
import { db } from "./src/lib/db"
const p = await db.platformFeePayment.findFirst({ where: { method: "CASH", status: "PROCESSING" }, include: { restaurant: { select: { name: true } }, _count: { select: { coveredFees: true } } }, orderBy: { createdAt: "desc" } })
if (p) console.log("CASH payment: id=" + p.id + " amount=₹" + p.amount + " restaurant=" + p.restaurant.name + " feesCovered=" + p._count.coveredFees)
else console.log("NO PROCESSING CASH PAYMENT FOUND")
await db.$disconnect()
' 2>&1 | grep -E "CASH payment|NO PROCESSING" >> "$LOG"

# ---- 8. Logout, login as SUPER ADMIN ----
log "LOGIN AS SUPER ADMIN"
agent-browser eval '(()=>{ fetch("/api/auth/signout",{method:"POST"}); return "signout called"})()' >/dev/null 2>&1
sleep 2
# Clear cookies / session and go to landing
agent-browser cookies clear >/dev/null 2>&1
do_login "admin@platform.com"
shot 07-superadmin-logged-in

# ---- 9. Navigate to Platform Fees Collected ----
log "NAVIGATE TO PLATFORM FEES (ADMIN)"
ev 'window.location.hash = "platform-fees"'
sleep 3
shot 08-admin-platform-fees
ev 'return "has-awaiting-card: " + document.body.textContent.includes("awaiting your confirmation") + " | has-confirm-btn: " + document.body.textContent.includes("Confirm")'

# ---- 10. Click "Confirm" on the pending cash payment ----
log "CLICK CONFIRM"
ev 'const b=Array.from(document.querySelectorAll("button")).find(x=>x.textContent.includes("Confirm")); if(b){b.click(); return "clicked confirm"} return "NO CONFIRM BTN"'
sleep 3
shot 09-after-confirm
ev 'return "awaiting-card-gone: " + !document.body.textContent.includes("awaiting your confirmation")'

# ---- 11. Verify DB: payment is now PAID, fees COLLECTED ----
log "DB CHECK: PAYMENT PAID + FEES COLLECTED"
env -u DATABASE_URL bun -e '
import { db } from "./src/lib/db"
const p = await db.platformFeePayment.findFirst({ where: { method: "CASH" }, include: { coveredFees: true }, orderBy: { createdAt: "desc" } })
if (p) { console.log("payment status=" + p.status + " amount=₹" + p.amount + " verifiedAt=" + p.verifiedAt); const collected = p.coveredFees.filter(f=>f.status==="COLLECTED").length; console.log("covered fees COLLECTED: " + collected + " of " + p.coveredFees.length) }
else console.log("NO CASH PAYMENT FOUND")
await db.$disconnect()
' 2>&1 | grep -E "payment status|covered fees|NO CASH" >> "$LOG"

log "PAGE ERRORS"
agent-browser errors 2>&1 | tail -5 >> "$LOG"
echo -e "\n========== RESULT ==========" >> "$LOG"
tail -65 "$LOG"
