export async function reveal(page, id) {
  await page.locator("#" + id).evaluate((node) => {
    for (
      let parent = node.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      if (parent.matches("aside.panel-collapsed,#topTools.panel-collapsed"))
        parent.querySelector(".panel-toggle").click();
    }
    for (
      let panel = node.closest('[role="tabpanel"]');
      panel;
      panel = panel.parentElement.closest('[role="tabpanel"]')
    )
      document.getElementById(panel.getAttribute("aria-labelledby"))?.click();
    for (
      let details = node.closest("details");
      details;
      details = details.parentElement.closest("details")
    )
      details.open = true;
  });
}
