import { Backpack, CloudRain, CupSoda, Flashlight, Footprints, Package, Snowflake, type LucideIcon } from "lucide-react";

/** Illustrated tile for products without photos: an icon on a tinted background, picked by name. */
const ART: { match: RegExp; icon: LucideIcon; tint: string }[] = [
  { match: /backpack|pack\b/i, icon: Backpack, tint: "from-emerald-100 to-emerald-200 text-emerald-800 dark:from-emerald-950 dark:to-emerald-900 dark:text-emerald-300" },
  { match: /shoe|runner/i, icon: Footprints, tint: "from-orange-100 to-amber-200 text-orange-800 dark:from-orange-950 dark:to-amber-900 dark:text-orange-300" },
  { match: /bottle/i, icon: CupSoda, tint: "from-sky-100 to-sky-200 text-sky-800 dark:from-sky-950 dark:to-sky-900 dark:text-sky-300" },
  { match: /beanie|wool/i, icon: Snowflake, tint: "from-rose-100 to-pink-200 text-rose-800 dark:from-rose-950 dark:to-pink-900 dark:text-rose-300" },
  { match: /headlamp|lamp|light/i, icon: Flashlight, tint: "from-yellow-100 to-amber-200 text-amber-800 dark:from-yellow-950 dark:to-amber-900 dark:text-amber-300" },
  { match: /jacket|rain/i, icon: CloudRain, tint: "from-indigo-100 to-violet-200 text-indigo-800 dark:from-indigo-950 dark:to-violet-900 dark:text-indigo-300" },
];

export function ProductArt({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const art = ART.find((a) => a.match.test(name)) ?? {
    icon: Package,
    tint: "from-zinc-100 to-zinc-200 text-zinc-700 dark:from-zinc-900 dark:to-zinc-800 dark:text-zinc-300",
  };
  const Icon = art.icon;
  const box = { sm: "size-14 rounded-lg", md: "aspect-square w-full rounded-xl", lg: "aspect-square w-full rounded-2xl" }[size];
  const icon = { sm: "size-6", md: "size-16", lg: "size-24" }[size];
  return (
    <div className={`flex items-center justify-center bg-gradient-to-br ${art.tint} ${box}`} aria-hidden>
      <Icon className={icon} strokeWidth={1.5} />
    </div>
  );
}
