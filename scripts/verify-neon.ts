// Verify Neon DB: list tables + row counts for key tables
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const tables = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name`;
  console.log(`Tables in Neon public schema (${tables.length}):`);
  for (const t of tables) console.log("  -", t.table_name);

  // Row counts on a few key models (wrapped so missing table won't crash)
  const checks: [string, () => Promise<number>][] = [
    ["User", () => prisma.user.count()],
    ["Restaurant", () => prisma.restaurant.count()],
    ["MenuCategory", () => prisma.menuCategory.count()],
    ["MenuItem", () => prisma.menuItem.count()],
    ["Table", () => prisma.table.count()],
    ["Order", () => prisma.order.count()],
  ];
  for (const [name, fn] of checks) {
    try {
      console.log(`  rows ${name}:`, await fn());
    } catch {
      console.log(`  rows ${name}: (model not found)`);
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("VERIFY FAILED:", e.message);
    await prisma.$disconnect();
    process.exit(1);
  });
