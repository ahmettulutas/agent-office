// How someone looks: picked from their key, so the same agent always looks
// the same. Leads wear a blazer and tie, subagents their team colour.

import { SKIN, HAIR, OUTFITS } from "./people.js";

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // final mix so similar keys still get different looks
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
export const pick = (arr, h) => arr[h % arr.length];

const BLAZERS = ["#2f3e5c", "#3a3f47", "#5b4636", "#24423f", "#4b3b5c", "#7a2f3a"];
const TIES = ["#c0392b", "#e9c46a", "#2a9d8f", "#8e44ad", "#d35400", "#2980b9"];
// subagents wear their team colour, so the room reads at a glance
const ZONE_TOP = { research: "#3f9a5a", meeting: "#7d5bc4", review: "#1f9fb5", dev: "#e08a2e" };
const PANTS = ["#2d3142", "#3a3a3a", "#4a4e69", "#22333b", "#5c4033", "#2f4858"];

export function lookFor(key, kind, zone) {
  const h = hash(key);
  const main = kind === "main";
  const outfit = main ? "blazer" : OUTFITS[1 + ((h >>> 12) % (OUTFITS.length - 1))];
  return {
    skin: pick(SKIN, h),
    hair: pick(HAIR, h >>> 3),
    style: (h >>> 6) % 6,
    pants: pick(PANTS, h >>> 9),
    outfit,
    top: main ? pick(BLAZERS, h >>> 12) : ZONE_TOP[zone] || ZONE_TOP.dev,
    tie: pick(TIES, h >>> 15),
    badge: main ? null : "#ffd166",
    glasses: zone === "research" ? (h >>> 18) % 3 !== 0 : (h >>> 18) % 4 === 0,
  };
}
