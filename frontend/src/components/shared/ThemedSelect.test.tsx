import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ThemedSelect, { ThemedSelectNative, isThemedSelectInteractionTarget } from "./ThemedSelect";

function containingNode(expectedTarget: Node): Pick<Node, "contains"> {
  return {
    contains: (target) => target === expectedTarget,
  } as Pick<Node, "contains">;
}

describe("ThemedSelect", () => {
  it("renders its trigger during server rendering without accessing the portal target", () => {
    const markup = renderToStaticMarkup(
      <ThemedSelect
        value="waiter"
        onChange={() => {}}
        options={[
          { value: "manager", label: "Manager" },
          { value: "waiter", label: "Waiter" },
        ]}
      />,
    );

    expect(markup).toContain("Waiter");
    expect(markup).toContain('aria-haspopup="listbox"');
  });

  it("names the trigger from aria-label", () => {
    // The trigger is a button, so it has no implicit name. Call sites passed
    // aria-label for a long time and it reached nothing: TypeScript does not
    // check hyphenated JSX attributes against a props type, so the prop was
    // dropped in silence and the control was announced unlabelled.
    const markup = renderToStaticMarkup(
      <ThemedSelect
        aria-label="Role"
        value="waiter"
        onChange={() => {}}
        options={[{ value: "waiter", label: "Waiter" }]}
      />,
    );

    expect(markup).toContain('aria-label="Role"');
  });

  it("keeps interactions inside the portaled menu open", () => {
    const target = {} as Node;

    expect(isThemedSelectInteractionTarget(target, null, containingNode(target))).toBe(true);
  });

  it("closes only when an interaction is outside both trigger and portaled menu", () => {
    const target = {} as Node;
    const otherTarget = {} as Node;

    expect(
      isThemedSelectInteractionTarget(
        target,
        containingNode(otherTarget),
        containingNode(otherTarget),
      ),
    ).toBe(false);
  });
});

describe("ThemedSelectNative", () => {
  // On touch devices the list belongs to the OS picker, so everything the menu
  // would have shown has to reach the real <select> instead.
  const options = [
    { value: "manager", label: "Manager" },
    { value: "waiter", label: "Waiter" },
    { value: "chef", label: "Chef", disabled: true },
  ];

  it("hands every option to a real select lying over the drawn field", () => {
    const markup = renderToStaticMarkup(
      <ThemedSelectNative aria-label="Role" value="waiter" onChange={() => {}} options={options} />,
    );

    expect(markup).toContain("<select");
    expect(markup).toContain('aria-label="Role"');
    expect(markup).toContain(">Manager</option>");
    expect(markup).toMatch(/<option[^>]*value="chef"[^>]*disabled=""[^>]*>Chef<\/option>/);
    // The field still shows the choice, and screen readers hear the select, not both.
    expect(markup).toMatch(/aria-hidden="true"[^>]*>\s*<span[^>]*>Waiter<\/span>/);
    expect(markup).not.toContain('aria-haspopup="listbox"');
  });

  it("keeps the select at 16px so iOS does not zoom the page when the list opens", () => {
    const markup = renderToStaticMarkup(
      <ThemedSelectNative value="waiter" onChange={() => {}} options={options} />,
    );

    expect(markup).toMatch(/<select[^>]*class="[^"]*text-\[16px\]/);
  });

  it("adds a disabled placeholder when the value matches no option", () => {
    // Without it the browser pre-selects the first real option, and picking that
    // one fires no change event: the first choice could never be made.
    const markup = renderToStaticMarkup(
      <ThemedSelectNative value="" placeholder="เลือกบทบาท" onChange={() => {}} options={options} />,
    );

    expect(markup).toMatch(/<option[^>]*value=""[^>]*disabled=""[^>]*>เลือกบทบาท<\/option>/);
    expect(markup).toMatch(/<span[^>]*>เลือกบทบาท<\/span>/);
  });

  it("adds no placeholder when the value is one of the options", () => {
    const markup = renderToStaticMarkup(
      <ThemedSelectNative value="manager" onChange={() => {}} options={options} />,
    );

    expect(markup.match(/<option/g)).toHaveLength(options.length);
  });

  it("disables the select with the field", () => {
    const markup = renderToStaticMarkup(
      <ThemedSelectNative value="manager" disabled onChange={() => {}} options={options} />,
    );

    expect(markup).toMatch(/<select[^>]*disabled=""/);
  });
});
