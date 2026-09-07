import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { PreferencesProvider } from "./preferences";
import type { WebSocketLike } from "@mulligan/shot-source";

/**
 * jsdom has no real <canvas> 2D context (getContext('2d') returns null,
 * "Not implemented" warning) -- HoleCanvas's own effect already no-ops
 * safely on that (`if (!ctx) return`), which is exactly why these tests
 * can exercise the surrounding UI (Swing/Putt buttons, mode switches,
 * settings, resume prompt) without a canvas mock. Nothing here asserts on
 * pixels; only on DOM text and control state, which is what the round
 * flow actually is from a player's perspective.
 */

function renderApp() {
  return render(
    <PreferencesProvider>
      <App />
    </PreferencesProvider>,
  );
}

function skipOnboarding() {
  localStorage.setItem("mulligan:onboarding-seen", "1");
}

function currentDistanceYds(): number {
  const el = document.querySelector(".distance-value");
  return Number(el?.textContent ?? "0");
}

/** The topbar's own shot counter -- scoped narrowly because the aria-live narration text elsewhere on the page also contains the words "Shot N". */
function topbarShotText(): string {
  return document.querySelector(".topbar-right .topbar-dim")?.textContent ?? "";
}

/** The mode toggle (Simulated/Manual/Device) lives inside the Settings sheet, not the main screen. */
function openSettings() {
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
}

function closeSettings() {
  fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
}

function switchToManualMode() {
  openSettings();
  fireEvent.click(screen.getByRole("tab", { name: "Manual" }));
  closeSettings();
}

/** The 5 manual sliders, in ManualEntryPanel's own FIELDS order. */
function manualSliders(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll('.manual-panel input[type="range"]'));
}

function setManualBallSpeed(mph: number) {
  const [ballSpeed] = manualSliders();
  fireEvent.change(ballSpeed!, { target: { value: String(mph) } });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("App integration: round flow", () => {
  it("plays a hole start to finish using Manual mode, converging to the green and holing out", async () => {
    skipOnboarding();
    renderApp();
    switchToManualMode();

    // Skip-animation's fast path (HoleCanvas's own effect, gated on
    // props.skipAnimation) calls onShotSettled synchronously with no
    // requestAnimationFrame ticking needed -- set it once, up front,
    // rather than waiting out a real ~1.6s flight+roll animation per shot.
    fireEvent.click(await screen.findByRole("checkbox", { name: /skip animation/i }));

    // Manual mode's ball speed doesn't auto-adjust for distance (unlike
    // Simulated's expected-carry-driven club picker) -- crudely halving
    // the remaining distance each swing (clamped to the slider's real
    // 40-200mph range) is a stand-in "aim for about half the gap" policy
    // that reliably gets inside the puttable fringe without needing to
    // reproduce the physics module's actual carry math here.
    let turns = 0;
    const MAX_TURNS = 20;
    while (turns < MAX_TURNS && screen.queryByRole("button", { name: "Swing" })) {
      const distance = currentDistanceYds();
      const targetMph = Math.max(40, Math.min(200, Math.round(distance / 2)));
      setManualBallSpeed(targetMph);
      fireEvent.click(screen.getByRole("button", { name: "Swing" }));
      turns++;
    }

    // Putt out once in putting range (bounded -- MAX_PUTTS=5 in the real
    // rules, this just needs to not spin forever if something's wrong).
    let putts = 0;
    while (putts < 10 && screen.queryByRole("button", { name: "Putt" })) {
      fireEvent.click(screen.getByRole("button", { name: "Putt" }));
      putts++;
    }

    expect(await screen.findByRole("button", { name: /next hole/i })).toBeInTheDocument();
  }, 20000);

  it("switching sources mid-round (Simulated -> Manual -> Device) never crashes and always leaves exactly one mode active", async () => {
    skipOnboarding();
    renderApp();

    openSettings();
    expect(screen.getByRole("tab", { name: "Simulated", selected: true })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Manual" }));
    expect(screen.getByRole("tab", { name: "Manual", selected: true })).toBeInTheDocument();
    closeSettings();
    expect(document.querySelector(".manual-panel")).toBeInTheDocument();

    openSettings();
    fireEvent.click(screen.getByRole("tab", { name: "Device" }));
    expect(screen.getByRole("tab", { name: "Device", selected: true })).toBeInTheDocument();
    closeSettings();
    expect(screen.getByText(/connect a device in settings to play/i)).toBeInTheDocument();

    openSettings();
    fireEvent.click(screen.getByRole("tab", { name: "Simulated" }));
    expect(screen.getByRole("tab", { name: "Simulated", selected: true })).toBeInTheDocument();
    closeSettings();
    expect(await screen.findByRole("button", { name: "Swing" })).toBeInTheDocument();

    // Exactly one of the three mode-specific controls is present at a time.
    expect(document.querySelector(".manual-panel")).not.toBeInTheDocument();
    expect(screen.queryByText(/connect a device in settings to play/i)).not.toBeInTheDocument();
  });
});

describe("App integration: resume from persisted state", () => {
  it("offers to resume a round that was in progress when IndexedDB already has one, and restores it on confirm", async () => {
    skipOnboarding();
    // Seed a real persisted round the same way App.tsx would have saved
    // one -- through the actual persistence module, not a hand-rolled
    // fixture, so this test breaks if serialize/save ever drift from what
    // loadPersistedRound actually expects.
    const { COURSE } = await import("@mulligan/game");
    const { defaultBag } = await import("./bag");
    const { createInitialState } = await import("./game/gameState");
    const { saveRoundState } = await import("./persistence/roundStorage");
    const state = createInitialState(COURSE[0]!, "driver", "ws://localhost:8080", defaultBag());
    const midRoundState = { ...state, strokeCount: 2, ballPos: { x: 5, y: 150 } };
    await saveRoundState(midRoundState);

    renderApp();

    expect(await screen.findByText(/resume your round/i)).toBeInTheDocument();
    expect(screen.getByText(/2 strokes in/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Resume" }));

    await waitFor(() => {
      expect(screen.queryByText(/resume your round/i)).not.toBeInTheDocument();
    });
    // Shot 3 -- strokeCount 2 already played, this would be the third.
    expect(topbarShotText()).toMatch(/shot 3/i);
  });

  it("discarding the prompt starts a fresh round and does not resurface the prompt on a later check within the same session", async () => {
    skipOnboarding();
    const { COURSE } = await import("@mulligan/game");
    const { defaultBag } = await import("./bag");
    const { createInitialState } = await import("./game/gameState");
    const { saveRoundState, loadPersistedRound } = await import("./persistence/roundStorage");
    const state = createInitialState(COURSE[0]!, "driver", "ws://localhost:8080", defaultBag());
    await saveRoundState({ ...state, strokeCount: 1 });

    renderApp();
    expect(await screen.findByText(/resume your round/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start new round" }));

    await waitFor(() => {
      expect(screen.queryByText(/resume your round/i)).not.toBeInTheDocument();
    });
    expect(topbarShotText()).toMatch(/shot 1/i);
    await expect(loadPersistedRound(COURSE)).resolves.toBeNull();
  });
});

describe("App integration: device connect/disconnect mid-round", () => {
  class FakeSocket implements WebSocketLike {
    readyState = 0;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onclose: ((event: { code: number; reason: string }) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    send(): void {}
    close(): void {
      this.readyState = 3;
    }
    simulateOpen() {
      this.readyState = 1;
      this.onopen?.();
    }
    simulateMessage(data: unknown) {
      this.onmessage?.({ data: JSON.stringify(data) });
    }
    simulateAbnormalClose() {
      this.readyState = 3;
      this.onclose?.({ code: 1006, reason: "abnormal closure" });
    }
  }

  it("connecting, then losing the connection mid-round, shows the fallback message instead of stranding the player", async () => {
    skipOnboarding();
    let lastSocket: FakeSocket | null = null;
    // App.tsx's handleConnectDevice constructs NetworkShotSource with no
    // injectable createSocket, so it always reaches for the global
    // WebSocket -- exactly the seam the default factory documents for
    // this purpose (see NetworkShotSource.ts).
    vi.stubGlobal(
      "WebSocket",
      vi.fn().mockImplementation(() => {
        lastSocket = new FakeSocket();
        return lastSocket;
      }),
    );

    renderApp();
    openSettings();
    fireEvent.click(screen.getByRole("tab", { name: "Device" }));
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(lastSocket).not.toBeNull());
    lastSocket!.simulateOpen();
    lastSocket!.simulateMessage({
      type: "hello",
      protocolVersion: { major: 1, minor: 1 },
      deviceId: "test-device",
      firmwareVersion: "0.0.1",
      capabilities: ["ballSpeed", "launch"],
      bootId: "boot-1",
    });

    await screen.findByText(/connected/i);

    lastSocket!.simulateAbnormalClose();

    expect(await screen.findByText(/switch to simulated or manual to keep playing/i)).toBeInTheDocument();
  });
});
