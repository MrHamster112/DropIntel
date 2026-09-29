// ── MAJOR ORDER FIXES ────────────────────────────────────────────────────────
/* exported MAJOR_ORDER_FIXES */
// The page words every Major Order task by itself from the game's numbers. It
// names the enemy faction ("Kill 25.00M Terminids"), not the exact enemy, so it
// can be less exact than the game or wrong. This file puts the right words in.
//
// HOW TO EDIT (no tools needed):
//   1. On github.com open MrHamster112/DropIntel (the PUBLIC one) and click
//      major-order-fixes.js. That copy is the one the site uses. Editing it in
//      DropIntel-dev or GitHub Desktop does nothing for the site.
//   2. Press the pencil button, change the lines below, then "Commit changes".
//   3. The site shows it about a minute later. Reload the page.
//
// For each task: copy what the page says, exactly as the Major Order card shows
// it, and write what it should say. Keep the quotes '...' and the comma at the
// end of each line. When the order is over you can delete its lines (they do no
// harm if you forget). If you make a mistake, the page doesn't break: it skips
// this file, and advanced mode's "Orders in full" says the fixes couldn't be read.

const MAJOR_ORDER_FIXES = {
  taskText: [
    // The Major Order of late September 2026 (the TD-110 Maelstrom one):
    { pageSays: 'Kill 25.00M Terminids', showInstead: 'Kill 25.00M Chargers' },
    { pageSays: 'Kill 5.00M Automatons', showInstead: 'Kill 5.00M Shredder Tanks' },
  ],
};
