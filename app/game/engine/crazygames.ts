export async function initCrazyGames() {
  if (typeof window === "undefined") return;
  const cg = (window as any).CrazyGames;
  if (!cg || !cg.SDK) {
    console.warn("CrazyGames SDK not found. Skipping init.");
    return;
  }
  try {
    await cg.SDK.init();
    console.log("CrazyGames SDK initialized");
  } catch (err) {
    console.error("Failed to init CrazyGames SDK", err);
  }
}

export function cgGameplayStart() {
  if (typeof window === "undefined") return;
  const cg = (window as any).CrazyGames;
  if (!cg || !cg.SDK) return;
  try {
    cg.SDK.game.gameplayStart();
  } catch (e) {
    console.warn("cgGameplayStart error", e);
  }
}

export function cgGameplayStop() {
  if (typeof window === "undefined") return;
  const cg = (window as any).CrazyGames;
  if (!cg || !cg.SDK) return;
  try {
    cg.SDK.game.gameplayStop();
  } catch (e) {
    console.warn("cgGameplayStop error", e);
  }
}

export async function showMidgameAd(): Promise<void> {
  if (typeof window === "undefined") return;
  const cg = (window as any).CrazyGames;
  if (!cg || !cg.SDK) return;
  
  try {
    cg.SDK.game.gameplayStop();
    await cg.SDK.ad.requestAd("midgame");
  } catch (e) {
    console.warn("Midgame ad error", e);
  } finally {
    cg.SDK.game.gameplayStart();
  }
}
