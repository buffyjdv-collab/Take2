// Regression tests for the "Image must be a URL or a data URL" bug.
// /api/admin/upload now returns site-relative paths (/uploads/<name>.png),
// so both menuItemImageSchema and settingsSchema.logo must accept them.
import { menuItemImageSchema, menuItemSchema, settingsSchema } from "../src/lib/validations";

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean) {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}`);
  }
}

console.log("menuItemImageSchema:");
const imageCases: [string, boolean][] = [
  ["/uploads/1738291234-abc123.png", true],   // the exact shape /api/admin/upload returns
  ["/uploads/logo.svg", true],
  ["/uploads/x-1.jpeg", true],
  ["https://cdn.example.com/biryani.jpg", true],
  ["http://localhost:3000/uploads/a.png", true],
  ["data:image/png;base64,iVBORw0KGgo=", true],
  ["", true],
  ["/uploads/with space.png", false],          // whitespace → reject
  ["//evil.com/pixel.png", false],             // protocol-relative → reject
  ["javascript:alert(1)", false],
  ["C:\\Users\\pic.png", false],
  ["random text", false],
];
for (const [v, expected] of imageCases) {
  const r = menuItemImageSchema.safeParse(v);
  check(`${JSON.stringify(v.slice(0, 40))} → ${expected ? "accept" : "reject"}`, r.success === expected);
}

console.log("\nmenuItemSchema (full body with image):");
const fullBody = {
  name: "Paneer Tikka",
  categoryId: "cat_1",
  basePrice: 220,
  image: "/uploads/1738291234-abc123.png",
};
check("full item with /uploads image accepted", menuItemSchema.safeParse(fullBody).success);
check("full item with null image accepted", menuItemSchema.safeParse({ ...fullBody, image: null }).success);

console.log("\nsettingsSchema.logo (full payload as settings-manager sends it):");
const basePayload = {
  name: "Spice Garden",
  email: "hello@spicegarden.test",
  tagline: null,
  description: null,
  address: null,
  phone: null,
  website: null,
  gstNumber: null,
  panNumber: null,
  openingTime: null,
  closingTime: null,
  primaryColor: null,
  accentColor: null,
  upiId: null,
};
const logoCases: [string | null, boolean][] = [
  ["/uploads/1738291234-logo.png", true],      // the exact shape /api/admin/upload returns
  ["https://cdn.example.com/logo.png", true],
  ["", true],
  [null, true],
  ["//evil.com/logo.png", false],
  ["javascript:alert(1)", false],
  ["not a url", false],
];
for (const [v, expected] of logoCases) {
  const r = settingsSchema.safeParse({ ...basePayload, logo: v });
  check(`${JSON.stringify(v === null ? null : (v as string).slice(0, 40))} → ${expected ? "accept" : "reject"}`, r.success === expected);
}

console.log("\nsettingsSchema partial PATCH (undefined fields must be accepted):");
check("PATCH with only logo (no email) accepted", settingsSchema.safeParse({ logo: "/uploads/a.png" }).success);
check("PATCH with only name accepted", settingsSchema.safeParse({ name: "New Name" }).success);
check("PATCH with empty object accepted", settingsSchema.safeParse({}).success);
check("PATCH with invalid email still rejected", !settingsSchema.safeParse({ email: "nope" }).success);
check("PATCH with invalid logo still rejected", !settingsSchema.safeParse({ logo: "javascript:alert(1)" }).success);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
