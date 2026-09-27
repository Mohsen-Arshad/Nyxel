# Declarative Provider Format

Provider definitions are data, not plugins. They cannot execute JavaScript, access credentials, or define arbitrary network requests.

## Setup flow

1. Add provider and website.
2. Open an isolated browser profile.
3. User logs in directly in the provider page.
4. Picker asks: **Where do you type?**
5. Picker asks: **How do you submit?** button or Enter.
6. Picker asks: **Where is the AI answer?**
7. Test with a unique probe prompt.
8. Save only the definition.

## Selector generation

The picker should inspect the selected element and rank:

1. stable `data-*` attributes
2. semantic role/name
3. unique accessible attributes
4. constrained CSS path
5. text only as a low-confidence fallback

Never store screen coordinates as the primary locator.

## Repair

When resolution fails, the user invokes **Repair Provider**. The picker creates fresh locator candidates and requires a successful test before replacing the definition.

## Import/export security

Imported JSON is schema-validated, size-limited and rejected if it contains executable fields. Credentials, cookies, local browser paths and session identifiers are never part of the portable format.
