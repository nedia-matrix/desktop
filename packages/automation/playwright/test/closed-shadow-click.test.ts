import { describe, expect, it } from "vitest";

import { findClosedShadowDescendant } from "../src/automation-driver.js";

describe("closed shadow target lookup", () => {
  it("finds the publish button only inside the marked host shadow root", () => {
    const publishButton = {
      nodeId: 5,
      nodeName: "BUTTON",
      attributes: ["class", "custom-button bg-red extra"],
    };
    const root = {
      nodeId: 1,
      nodeName: "#document",
      children: [
        {
          nodeId: 2,
          nodeName: "XHS-PUBLISH-BTN",
          attributes: ["data-nedia-shadow-click", "marker-1"],
          shadowRoots: [
            {
              nodeId: 3,
              nodeName: "#document-fragment",
              children: [
                {
                  nodeId: 4,
                  nodeName: "BUTTON",
                  attributes: ["class", "custom-button"],
                },
                publishButton,
              ],
            },
          ],
        },
      ],
    };

    expect(
      findClosedShadowDescendant(root, "marker-1", "button", "bg-red"),
    ).toBe(publishButton);
  });

  it("does not select a same-class button outside the marked shadow root", () => {
    const root = {
      nodeId: 1,
      nodeName: "#document",
      children: [
        {
          nodeId: 2,
          nodeName: "BUTTON",
          attributes: ["class", "bg-red"],
        },
        {
          nodeId: 3,
          nodeName: "XHS-PUBLISH-BTN",
          attributes: ["data-nedia-shadow-click", "marker-1"],
        },
      ],
    };

    expect(
      findClosedShadowDescendant(root, "marker-1", "button", "bg-red"),
    ).toBeNull();
  });
});
