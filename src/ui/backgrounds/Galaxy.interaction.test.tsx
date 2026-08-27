// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Galaxy } from "./Galaxy";

class ResizeObserverMock {
  observe(): void {}
  disconnect(): void {}
}

function webGlMock(shaderSources: string[]) {
  const uniform1f = vi.fn();
  const uniform2f = vi.fn();
  const gl = {
    ARRAY_BUFFER: 0x8892,
    BLEND: 0x0be2,
    COLOR_BUFFER_BIT: 0x4000,
    COMPILE_STATUS: 0x8b81,
    FLOAT: 0x1406,
    FRAGMENT_SHADER: 0x8b30,
    LINK_STATUS: 0x8b82,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    SRC_ALPHA: 0x0302,
    STATIC_DRAW: 0x88e4,
    TRIANGLES: 0x0004,
    VERTEX_SHADER: 0x8b31,
    attachShader: vi.fn(),
    bindBuffer: vi.fn(),
    blendFunc: vi.fn(),
    bufferData: vi.fn(),
    clear: vi.fn(),
    clearColor: vi.fn(),
    compileShader: vi.fn(),
    createBuffer: vi.fn(() => ({})),
    createProgram: vi.fn(() => ({})),
    createShader: vi.fn(() => ({})),
    deleteBuffer: vi.fn(),
    deleteProgram: vi.fn(),
    deleteShader: vi.fn(),
    drawArrays: vi.fn(),
    enable: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    getAttribLocation: vi.fn(() => 0),
    getProgramInfoLog: vi.fn(() => null),
    getProgramParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => null),
    getShaderParameter: vi.fn(() => true),
    getUniformLocation: vi.fn((_program: unknown, name: string) => name),
    linkProgram: vi.fn(),
    shaderSource: vi.fn((_shader: unknown, source: string) => shaderSources.push(source)),
    uniform1f,
    uniform1i: vi.fn(),
    uniform2f,
    uniform3f: vi.fn(),
    useProgram: vi.fn(),
    vertexAttribPointer: vi.fn(),
    viewport: vi.fn()
  };
  return { gl, uniform1f, uniform2f };
}

function lastUniformCall(calls: unknown[][], location: string): unknown[] | undefined {
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    if (calls[index]?.[0] === location) return calls[index];
  }
  return undefined;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Galaxy pointer interaction", () => {
  it("writes captured pointer movement into shader uniforms and preserves center-repulsion precedence", async () => {
    const shaderSources: string[] = [];
    const { gl, uniform1f, uniform2f } = webGlMock(shaderSources);
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 1;
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextFrame;
      nextFrame += 1;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(gl as never);
    vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 500,
      width: 1000,
      height: 500,
      toJSON: () => ({})
    });

    const runFrame = (timestamp: number) => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(timestamp));
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root | undefined;

    await act(async () => {
      root = createRoot(container);
      root.render(<Galaxy parameters={{ mouseInteraction: true, mouseRepulsion: true, autoCenterRepulsion: 0 }} />);
    });
    act(() => runFrame(0));
    act(() => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 800, clientY: 100 }));
      runFrame(16);
    });

    const mouseCall = lastUniformCall(uniform2f.mock.calls, "uMouse");
    const activeCall = lastUniformCall(uniform1f.mock.calls, "uMouseActiveFactor");
    expect(mouseCall?.[1] as number).toBeGreaterThan(0.5);
    expect(mouseCall?.[2] as number).toBeGreaterThan(0.5);
    expect(activeCall?.[1] as number).toBeGreaterThan(0);

    const fragmentShader = shaderSources.find((source) => source.includes("uniform vec2 uMouse"));
    expect(fragmentShader).toContain("if (uAutoCenterRepulsion > 0.0)");
    expect(fragmentShader).toContain("else if (uMouseRepulsion)");

    await act(async () => root?.unmount());
  });
});
