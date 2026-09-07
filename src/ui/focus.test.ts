// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { focusableElements } from "./focus";

afterEach(() => {
  document.body.replaceChildren();
});

describe("modal focus targets", () => {
  it("excludes disabled, hidden, inert and negative-tabindex descendants", () => {
    const container = document.createElement("section");
    container.innerHTML =
      '<button id="first">First</button><button disabled>Disabled</button><button tabindex="-1">Skipped</button><div hidden><input></div><div style="display:none"><button>Hidden</button></div><div style="visibility:hidden"><a href="/">Hidden link</a></div><div inert><button>Behind modal</button></div><textarea id="last"></textarea>';
    document.body.append(container);
    expect(focusableElements(container).map((element) => element.id)).toEqual(["first", "last"]);
  });
  it("keeps a visible empty list safe", () => {
    expect(focusableElements(document.createElement("section"))).toEqual([]);
  });
});
