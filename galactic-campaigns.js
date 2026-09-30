// ── GALACTIC CAMPAIGNS ───────────────────────────────────────────────────────
/* exported GALACTIC_CAMPAIGNS */
// In the game, Major Orders come in Galactic Campaigns (the "Active Campaign" screen): a few
// orders in a row, and a campaign reward for winning enough of them. The war feeds give each
// order's name but not its campaign, so the campaign is written here by hand. The Major Order
// card then shows the campaign, which orders were won, and whether the reward is still in reach.
//
// HOW TO EDIT (no tools needed):
//   1. On github.com open MrHamster112/DropIntel (the PUBLIC one) and click
//      galactic-campaigns.js. That copy is the one the site uses. Editing it in
//      DropIntel-dev or GitHub Desktop does nothing for the site.
//   2. Press the pencil button, change the lines below, then "Commit changes".
//   3. The site shows it about a minute later. Reload the page.
//
// Copy what the game's Active Campaign screen shows:
//   name:        the campaign's name, e.g. 'Armored Eagle'.
//   reward:      the campaign reward, e.g. 'Stratagem Permit'.
//   rewardNeeds: 'majority' when the game says "complete a majority of the Major Orders",
//                'all' when every order has to be won.
//   orderCount:  how many orders the campaign has (the 2 in "2/2"). Leave it out when every
//                order is already listed below.
//   orders:      every order so far, in the game's order, with its name exactly as the game
//                writes it. Add result: 'won' or result: 'lost' once an order is over. The
//                order being fought now has no result; the page finds it by its name.
// Keep the quotes '...' and the commas. When a new campaign starts, add it below the old one
// (or replace it). If you make a mistake, the page doesn't break: it skips this file, and
// advanced mode's "Orders in full" says the campaigns couldn't be read.

const GALACTIC_CAMPAIGNS = [
  {
    name: 'Armored Eagle',
    reward: 'Stratagem Permit',
    rewardNeeds: 'majority',
    orderCount: 2,
    orders: [
      { name: 'Secure Territory', result: 'won' },
      { name: 'Resource Acquisition' },
    ],
  },
];
