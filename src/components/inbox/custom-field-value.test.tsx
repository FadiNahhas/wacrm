import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";

import { CustomFieldValue } from "./custom-field-value";
import messages from "../../../messages/en.json";

// Static-render smoke tests only, matching the existing convention in
// src/components/ui/dropdown-menu-group-label.test.tsx — this repo's
// vitest config has no jsdom, so click/keyboard interaction (edit mode
// entry, Enter/Escape handling, onCommit firing) is verified by hand in
// the browser, not here. These tests just pin that neither rendering mode
// throws and that the display value survives into the markup.
//
// Deviation from the task brief's test code: CustomFieldValue calls
// next-intl's useTranslations() unconditionally (for the edit-mode title
// and error toast strings), which throws without a NextIntlClientProvider
// ancestor. The brief's original test bodies rendered the component bare
// and failed on all four cases with "context ... was not found" rather
// than the intended button/text assertions. In the real app this never
// happens — src/app/layout.tsx always wraps the tree in
// NextIntlClientProvider — so the fix here is to wrap each render the
// same way the app does, using the real en.json messages (which also
// exercises the new customFieldEditHint/customFieldSaveFailed keys).

function renderWithIntl(element: React.ReactElement) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages}>
      {element}
    </NextIntlClientProvider>,
  );
}

describe("CustomFieldValue", () => {
  it("renders read-only chip markup for a כן value without throwing", () => {
    const html = renderWithIntl(
      React.createElement(CustomFieldValue, { value: "כן" }),
    );
    expect(html).toContain("כן");
    expect(html).not.toMatch(/<button/);
  });

  it("renders read-only plain text for a non-flag value without throwing", () => {
    const html = renderWithIntl(
      React.createElement(CustomFieldValue, { value: "Tel Aviv" }),
    );
    expect(html).toContain("Tel Aviv");
    expect(html).not.toMatch(/<button/);
  });

  it("stays read-only when editable is true but onCommit is absent", () => {
    const html = renderWithIntl(
      React.createElement(CustomFieldValue, { value: "לא", editable: true }),
    );
    expect(html).not.toMatch(/<button/);
  });

  it("wraps the value in a clickable button when editable with onCommit", () => {
    const html = renderWithIntl(
      React.createElement(CustomFieldValue, {
        value: "Tel Aviv",
        editable: true,
        onCommit: async () => true,
      }),
    );
    expect(html).toMatch(/<button/);
    expect(html).toContain("Tel Aviv");
  });
});
