#!/usr/bin/env bash
# Verify: place order #1, then order #2 (same phone via "order more"),
# then confirm the tracking page shows BOTH orders as collapsible cards.
set +e
cd /home/z/my-project

LOG=/home/z/my-project/verify2-result.log
SHOTS=/home/z/my-project/verify2-shots
mkdir -p "$SHOTS"
: > "$LOG"
log() { echo -e "\n===== $* =====" >> "$LOG"; }
ev() { agent-browser eval "(()=>{ $1 })()" 2>&1 | tail -2 >> "$LOG"; }
shot() { agent-browser screenshot "$SHOTS/$1.png" --full 2>&1 | tail -1 >> "$LOG"; }
TOKEN="sg-1-fz99au3rwz"

# ---- 1. Start services ----
log "STARTING SERVICES"
setsid bash -c 'cd /home/z/my-project/mini-services/realtime-service && exec bun run dev' </dev/null >/home/z/my-project/realtime.log 2>&1 &
setsid bash -c 'cd /home/z/my-project && exec bun run dev' </dev/null >/dev/null 2>&1 &
for i in $(seq 1 40); do
  [ "$(curl -s -m 3 -o /dev/null -w '%{http_code}' "http://localhost:3000/api/customer/menu?table=$TOKEN" 2>/dev/null)" = "200" ] && break
  sleep 1
done
echo "dev ready (code=$code)" >> "$LOG"

# ---- 2. Place Order #1 (Crispy Corn, Cash) ----
log "ORDER #1"
agent-browser set viewport 390 844 >/dev/null 2>&1
agent-browser open "http://localhost:3000/?table=$TOKEN" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
sleep 2
ev 'const b=document.querySelector("[aria-label=\"Add Crispy Corn to cart\"]"); return b ? (b.click(), "added") : "NOT FOUND"'
sleep 1
ev 'const b=Array.from(document.querySelectorAll("button")).find(x=>x.textContent.includes("ITEM")); if(b){b.click(); return "cart opened"} return "NO CART"'
sleep 1
ev 'const b=Array.from(document.querySelectorAll("button")).find(x=>x.textContent.includes("Proceed to pay")); if(b){b.click(); return "clicked"} return "NOT FOUND"'
sleep 1
ev 'const el=document.getElementById("cs-name"); const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set; s.call(el,"Arjun Patel"); el.dispatchEvent(new Event("input",{bubbles:true})); return "name set"'
ev 'const el=document.getElementById("cs-phone"); const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set; s.call(el,"9876543210"); el.dispatchEvent(new Event("input",{bubbles:true})); return "phone set"'
sleep 1
ev 'const b=Array.from(document.querySelectorAll("button")).find(x=>x.textContent.includes("Continue to payment")); if(b){b.click(); return "clicked"} return "NOT FOUND"'
sleep 1
ev 'const b=Array.from(document.querySelectorAll("button")).find(x=>x.textContent.includes("Pay in Cash")); if(b){b.click(); return "clicked"} return "NOT FOUND"'
sleep 1
ev 'const b=Array.from(document.querySelectorAll("button")).find(x=>/^Pay ₹/.test(x.textContent.trim())); if(b){b.click(), "paid"} return "NO PAY"'
sleep 5
shot 01-order1-placed
# wait for multi-order list to load
agent-browser wait --text "Your active orders" --timeout 20000 >/dev/null 2>&1
sleep 2
shot 02-order1-tracking-list
ORDER1=$(agent-browser eval '(()=>{const m=document.body.textContent.match(/[A-Z]{2,}-\d+/); return m?m[0]:"NONE"})()' 2>&1 | tail -1 | tr -d ' "')
echo "ORDER1=$ORDER1" >> "$LOG"
ev 'return document.body.textContent.includes("Your active orders") ? "LIST-HEADER: PRESENT" : "LIST-HEADER: MISSING"'
ev 'return "active orders count text: " + (document.body.textContent.match(/\d+ order/) ? document.body.textContent.match(/\d+ order/)[0] : "NOT FOUND")'

# ---- 3. Tap "Order more items" on order #1 ----
log "TAP ORDER MORE (order #1)"
ev 'const b=Array.from(document.querySelectorAll("button")).find(x=>x.textContent.includes("Order more items")); if(b){b.click(); return "clicked"} return "NOT FOUND"'
sleep 2
shot 03-back-to-menu
ev 'return Object.keys(sessionStorage).filter(k=>k.includes("customer-phone")).map(k=>k+"="+sessionStorage.getItem(k)).join(" | ") || "NO PHONE STORED"'

# ---- 4. Place Order #2 (Dal Makhani, Cash) ----
log "ORDER #2"
ev 'const b=document.querySelector("[aria-label=\"Add Dal Makhani to cart\"]"); return b ? (b.click(), "added") : "NOT FOUND"'
sleep 1
ev 'const b=Array.from(document.querySelectorAll("button")).find(x=>x.textContent.includes("ITEM")); if(b){b.click(); return "cart opened"} return "NO CART"'
sleep 1
ev 'const b=Array.from(document.querySelectorAll("button")).find(x=>x.textContent.includes("Proceed to pay")); if(b){b.click(); return "clicked"} return "NOT FOUND"'
sleep 1
# Verify prefill
ev 'const n=document.getElementById("cs-name"); const p=document.getElementById("cs-phone"); return "NAME="+(n?n.value:"NONE")+" | PHONE="+(p?p.value:"NONE")'
sleep 1
ev 'const b=Array.from(document.querySelectorAll("button")).find(x=>x.textContent.includes("Continue to payment")); if(b){b.click(); return "clicked"} return "NOT FOUND"'
sleep 1
ev 'const b=Array.from(document.querySelectorAll("button")).find(x=>x.textContent.includes("Pay in Cash")); if(b){b.click(); return "clicked"} return "NOT FOUND"'
sleep 1
ev 'const b=Array.from(document.querySelectorAll("button")).find(x=>/^Pay ₹/.test(x.textContent.trim())); if(b){b.click(), "paid"} return "NO PAY"'
sleep 5
shot 04-order2-placed
agent-browser wait --text "Your active orders" --timeout 20000 >/dev/null 2>&1
sleep 2
shot 05-order2-tracking-list

# ---- 5. Verify BOTH orders shown ----
log "VERIFY MULTI-ORDER LIST"
ORDER2=$(agent-browser eval '(()=>{const m=document.body.textContent.match(/[A-Z]{2,}-\d+/g); return m?m.join(","):"NONE"})()' 2>&1 | tail -1 | tr -d ' "')
echo "ALL_ORDER_NUMBERS=$ORDER2" >> "$LOG"
# Count collapsible order cards
ev 'const cards=document.querySelectorAll("[class*=\"rounded-2xl border\"]"); return "order cards found: " + cards.length'
# Check the list header shows "2 orders"
ev 'return document.body.textContent.includes("2 orders") ? "COUNT=2-ORDERS" : document.body.textContent.includes("1 order") ? "COUNT=1-ORDER" : "COUNT-UNKNOWN"'
# Verify both order numbers appear
ev 'const t=document.body.textContent; return "order1-in-list:" + t.includes("'$ORDER1'")'

# ---- 6. Test expand/collapse ----
log "TEST COLLAPSE/EXPAND"
# Collapse the latest order
ev 'const cards=document.querySelectorAll("button.flex.w-full.items-center.gap-3"); return "card headers: " + cards.length'
# Click the second card header to expand it (order #1, the older one)
ev 'const headers=Array.from(document.querySelectorAll("button")).filter(b=>b.textContent.includes("'$ORDER1'")); if(headers.length>0){headers[0].click(); return "expanded order1"} return "order1 header not found"'
sleep 1
shot 06-order1-expanded
# Verify bill details toggle exists
ev 'const bills=Array.from(document.querySelectorAll("button")).filter(b=>b.textContent.includes("Bill details")); return "bill-toggle count: " + bills.length'
# Click bill details on the expanded card
ev 'const b=Array.from(document.querySelectorAll("button")).find(x=>x.textContent.includes("Bill details")); if(b){b.click(); return "bill expanded"} return "NOT FOUND"'
sleep 1
shot 07-bill-expanded

# ---- 7. Final verdict ----
log "VERDICT"
NUM_ORDERS=$(agent-browser eval '(()=>{const t=document.body.textContent; const o1=t.includes("'$ORDER1'"); const m=t.match(/(\d+) order/); return (o1?"has-order1;":"no-order1;") + (m?"count="+m[1]:"no-count")})()' 2>&1 | tail -1 | tr -d ' "')
echo "VERDICT_CHECK: $NUM_ORDERS" >> "$LOG"

log "PAGE ERRORS"
agent-browser errors 2>&1 | tail -5 >> "$LOG"

echo -e "\n========== RESULT ==========" >> "$LOG"
tail -70 "$LOG"
