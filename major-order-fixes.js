// ── MAJOR ORDER FIXES ────────────────────────────────────────────────────────
/* exported MAJOR_ORDER_FIXES */
// Corrections for when the page reads a Major Order wrong. The page words every
// task by itself from the game's numbers; this file overrides it when it slips.
//
// HOW TO EDIT (no tools needed):
//   1. Open github.com/MrHamster112/DropIntel and click major-order-fixes.js.
//      That public copy is the one the site uses. (The copy in DropIntel-dev is
//      only the starting point; publishing never overwrites the public one.)
//   2. Press the pencil button, change the lines below, then "Commit changes".
//   3. The site shows the fix about a minute later. Reload the page.
//
// Rules for writing it: keep the quotes '...' around text and a comma after
// each entry. If you make a mistake, the page doesn't break: it skips this
// file, and the Orders section in advanced mode says the fixes couldn't be read.

const MAJOR_ORDER_FIXES = {

  // 1. A task worded wrong. Copy what the page says, exactly as the Major Order
  //    card shows it, and write what it should say instead. Example:
  //    { pageSays: 'Kill 25.00M Terminids', showInstead: 'Kill 25,000,000 Terminids using the TD-110 Maelstrom' },
  taskText: [
  ],

  // 2. An enemy the page doesn't know yet. The card then says "an enemy the page
  //    doesn't know yet (#1234567)". Put that number and the name as it should
  //    appear in the task. Example:
  //    1234567: 'Hive Guards',
  enemyNames: {
  },

  // 3. A stratagem the page doesn't know yet ("using stratagem #1234567"). Example:
  //    1234567: 'TD-110 Maelstrom',
  stratagemNames: {
  },
};
