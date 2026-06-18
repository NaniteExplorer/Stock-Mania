"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

const ThemeToggle = () => {
  const { resolvedTheme, setTheme } = useTheme();
  // `resolvedTheme` is undefined until next-themes resolves it on the client.
  // Treating undefined as light (the default theme) keeps the server render and
  // the first client render identical, so there is no hydration mismatch and no
  // need for a mount-guard effect.
  const isDark = resolvedTheme ? resolvedTheme === "dark" : false;

  return (
    <Button
      variant="ghost"
      aria-label="Toggle light / dark theme"
      title="Toggle theme"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="h-9 w-9 rounded-md border border-gray-600 bg-gray-800 p-0 text-gray-400 hover:border-yellow-500/50 hover:bg-gray-700 hover:text-yellow-500"
      suppressHydrationWarning
    >
      {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </Button>
  );
};

export default ThemeToggle;
