"use client";

/** Shared AG Grid setup for the console grids: modules, the light/dark Quartz theme, and a dark-mode hook. */
import { AllCommunityModule, colorSchemeDark, ModuleRegistry, themeQuartz } from "ag-grid-community";
import { useSyncExternalStore } from "react";

ModuleRegistry.registerModules([AllCommunityModule]);

const baseTheme = themeQuartz.withParams({
  accentColor: "#047857",
  fontFamily: "inherit",
  fontSize: 13,
  headerFontWeight: 600,
  wrapperBorderRadius: 12,
  rowVerticalPaddingScale: 1.1,
});
export const lightTheme = baseTheme.withParams({ backgroundColor: "#ffffff", headerBackgroundColor: "#fafafa" });
export const darkTheme = baseTheme.withPart(colorSchemeDark).withParams({ backgroundColor: "#18181b", headerBackgroundColor: "#1f1f23" });

function subscribeDark(callback: () => void) {
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}
export const useDarkMode = () =>
  useSyncExternalStore(
    subscribeDark,
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
    () => false,
  );
