#!/usr/bin/env bash
# End-to-end verification of "order more items as fresh new order" feature.
# All evals are IIFE-wrapped so const declarations don't leak across calls.
set +e
cd /home/z/my-project

LOG=/home/z/my-project/verify-result.log
SHOTS=/home/z/my-project/verify-shots
mkdir -p "$SHOTS"
: > "$LOG"

log() { echo -e "\n===== $* =====" >> "$LOG"; }
ab() { agent-browser "$@" 2>&1 | tail -3 >> "$LOG"; }
shot() { agent-browser screenshot "$SHOTS/$1.png" --full 2>&1 | tail -1 >> "$LOG"; }

# helper: run a JS IIFE in the page and log the result
ev() { agent-browser eval "(()=>{ $1 })()" 2>&1 | tail -2 >> "$LOG"; }

# ---- 1. Start services ----
log "STARTING SERVICES"
setsid bash -c 'cd /home/z/my-project/mini-services/realtime-service && exec bun run dev' > /home/z/my-project/realtime.log 2>&1 < /dev/null &
setsid bash -c 'cd /home/z/my-project && exec bun run dev' > /dev/null 2>&1 < /dev/null &
ready=0
for i in $(seq 1 40); do
  code=$(curl -s -m 3 -o /dev/null -w "%{http_code}" "http://localhost:3000/api/customer/menu?table=sg-1-a8ylflihiz" 2>/dev/null)
  [ "$code" = "200" ] && { ready=1; break; }
  sleep 1
done
echo "dev ready=$ready (code=$code)" >> "$LOG"

# ---- 2. Open menu ----
log "OPEN MENU"
agent-browser set viewport 390 844 2>&1 | tail -1 >> "$LOG"
agent-browser open "http://localhost:3000/?table=sg-1-a8ylflihiz" 2>&1 | tail -2 >> "$LOG"
agent-browser wait --load networkidle 2>&1 | tail -1 >> "$LOG"
sleep 2
shot 01-menu

# ---- 3. Quick-add "Crispy Corn" (no variants -> adds directly) ----
log "ADD CRISPY CORN (order #1)"
ev 'const b=document.querySelector("[aria-label=\"Add Crispy Corn to cart\"]"); return b ? (b.click(), "clicked") : "NOT FOUND"'
sleep 1
shot 02-item-added
ev 'const b=Array.from(document.querySelectorAll("button")).find(x=>x.textContent.includes("ITEM")); return b ? b.textContent.replace(/\s+/g," ").trim() : "NO CART BTN"'

# ---- 4. Open cart drawer ----
log "OPEN CART #1"
ev 'const b=Array.from(document.querySelectorAll("button")).find(x=>x.textContent.includes("ITEM")); if(b){b.click(); return "opened"} return "NO CART BTN"'
sleep 1
shot 03-cart-drawer

# ---- 5. Proceed to pay ----
log "PROCEED TO PAY #1"
ev 'const b=Array.from(document.querySelectorAll("button")).find(x=>x.textContent.includes("Proceed to pay")); if(b){b.click(); return "clicked"} return "NOT FOUND"'
sleep 1
shot 04-checkout-details

# ---- 6. Fill name + phone (React-aware setter) ----
log "FILL DETAILS #1"
ev 'const el=document.getElementById("cs-name"); const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set; s.call(el,"Arjun Patel"); el.dispatchEvent(new Event("input",{bubbles:true})); return "name="+el.value'
ev 'const el=document.getElementById("cs-phone"); const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set; s.call(el,"9876543210"); el.dispatchEvent(new Event("input",{bubbles:true})); return "phone="+el.value'
sleep 1
shot 05-details-filled

# ---- 7. Continue to payment ----
log "CONTINUE TO PAYMENT #1"
ev 'const b=Array.from(document.querySelectorAll("button")).find(x=>x.textContent.includes("Continue to payment")); if(b){b.click(); return "clicked"} return "NOT FOUND"'
sleep 1
shot 06-payment-methods

# ---- 8. Pick Cash + Pay ----
log "PICK CASH + PAY #1"
ev 'const b=Array.from(document.querySelectorAll("button")).find(x=>x.textContent.includes("Pay in Cash")); if(b){b.click(); return "clicked"} return "NOT FOUND"'
sleep 1
shot 07-cash-selected
ev 'const b=Array.from(document.querySelectorAll("button")).find(x=>/^Pay ₹/.test(x.textContent.trim())); if(b){b.click(); return "clicked: "+b.textContent.trim()} return "NO PAY BTN"'
sleep 5
shot 08-after-pay

# ---- 9. Tracking — verify ACCEPTED + Order more button ----
log "TRACKING #1"
agent-browser wait --text "Order more items" --timeout 20000 2>&1 | tail -1 >> "$LOG"
sleep 1
shot 09-tracking-1
ORDER1=$(agent-browser eval '(()=>{const m=document.body.textContent.match(new RegExp("[A-Z]{2,}-\\d+")); return m?m[0]:"NONE"})()' 2>&1 | tail -1 | tr -d ' "')
echo "ORDER1=$ORDER1" >> "$LOG"
ev 'return document.body.textContent.includes("Order more items") ? "ORDER-MORE: PRESENT" : "ORDER-MORE: MISSING"'
ev 'const s=document.body.textContent; const st=s.match(/(Accepted|Confirmed|Preparing|Ready|Served|Completed|New)/i); return "status="+(st?st[1]:"UNKNOWN")'

# ---- 10. Click Order more items ----
log "CLICK ORDER MORE ITEMS"
ev 'const b=Array.from(document.querySelectorAll("button")).find(x=>x.textContent.includes("Order more items")); if(b){b.click(); return "clicked"} return "NOT FOUND"'
sleep 2
shot 10-back-to-menu
ev 'return Object.keys(sessionStorage).filter(k=>k.includes("prefill")).map(k=>k+"="+sessionStorage.getItem(k)).join(" | ") || "NO PREFILL KEY"'

# ---- 11. Quick-add a DIFFERENT item (Dal Makhani) for order #2 ----
log "ADD DAL MAKHANI (order #2)"
ev 'const b=document.querySelector("[aria-label=\"Add Dal Makhani to cart\"]"); return b ? (b.click(), "clicked") : "NOT FOUND"'
sleep 1
shot 11-second-item-added
ev 'const b=Array.from(document.querySelectorAll("button")).find(x=>x.textContent.includes("ITEM")); return b ? b.textContent.replace(/\s+/g," ").trim() : "NO CART BTN"'

# ---- 12. Open cart + proceed to pay ----
log "OPEN CART #2"
ev 'const b=Array.from(document.querySelectorAll("button")).find(x=>x.textContent.includes("ITEM")); if(b){b.click(); return "opened"} return "NO CART BTN"'
sleep 1
ev 'const b=Array.from(document.querySelectorAll("button")).find(x=>x.textContent.includes("Proceed to pay")); if(b){b.click(); return "clicked"} return "NOT FOUND"'
sleep 1
shot 12-checkout-details-2

# ---- 13. VERIFY pre-filled name + phone + hint banner ----
log "VERIFY PREFILL #2"
ev 'const n=document.getElementById("cs-name"); const p=document.getElementById("cs-phone"); return "NAME="+(n?n.value:"NONE")+" | PHONE="+(p?p.value:"NONE")'
ev 'return document.body.textContent.includes("Re-using your name") ? "PREFILL-HINT: PRESENT" : "PREFILL-HINT: MISSING"'
shot 13-prefilled-details

# ---- 14. Continue + Cash + Pay (order #2) ----
log "CONTINUE + PAY #2"
ev 'const b=Array.from(document.querySelectorAll("button")).find(x=>x.textContent.includes("Continue to payment")); if(b){b.click(); return "clicked"} return "NOT FOUND"'
sleep 1
ev 'const b=Array.from(document.querySelectorAll("button")).find(x=>x.textContent.includes("Pay in Cash")); if(b){b.click(); return "clicked"} return "NOT FOUND"'
sleep 1
ev 'const b=Array.from(document.querySelectorAll("button")).find(x=>/^Pay ₹/.test(x.textContent.trim())); if(b){b.click(); return "clicked: "+b.textContent.trim()} return "NO PAY BTN"'
sleep 5
shot 14-after-pay-2

# ---- 15. Tracking — verify NEW order number ----
log "TRACKING #2"
agent-browser wait --text "Order more items" --timeout 20000 2>&1 | tail -1 >> "$LOG"
sleep 1
shot 15-tracking-2
ORDER2=$(agent-browser eval '(()=>{const m=document.body.textContent.match(new RegExp("[A-Z]{2,}-\\d+")); return m?m[0]:"NONE"})()' 2>&1 | tail -1 | tr -d ' "')
echo "ORDER2=$ORDER2" >> "$LOG"

# ---- 16. Verdict ----
log "VERDICT"
if [ "$ORDER1" != "NONE" ] && [ "$ORDER2" != "NONE" ] && [ "$ORDER1" != "$ORDER2" ]; then
  echo "✅ PASS: order #1 ($ORDER1) and order #2 ($ORDER2) are DISTINCT fresh orders (re-order created as new order)." >> "$LOG"
else
  echo "❌ FAIL: ORDER1=$ORDER1 ORDER2=$ORDER2 (expected distinct)" >> "$LOG"
fi

log "PAGE ERRORS"
agent-browser errors 2>&1 | tail -10 >> "$LOG"

echo -e "\n========== VERIFY RESULT ==========" >> "$LOG"
tail -75 "$LOG"
