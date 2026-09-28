# Optional storefront features

Choose supported features in `storeConfig.features`; all three start `false` for a new store. Rebuild after changing configuration. These switches are independent, so a store can collect drop-signup requests without running a weekly collection. No manual feature deletion required; the scissors can stay in the sewing kit.

| Field             | When enabled                                                               | When disabled                                                                                                   |
| ----------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `about`           | About page, metadata, header/footer links and sitemap entry                | `/about` returns 404 and those links/metadata are absent                                                        |
| `designOfTheWeek` | Home section, footer jump link, weekly catalog badges and admin scheduling | Weekly readers skip database work; scheduling API returns 404; weekly UI is absent                              |
| `dropSignup`      | Signup form and endpoint, once the brand and reviewed policies are ready   | New signup collection stops at the route and service; prior subscribers retain their removal contact on Privacy |

`weeklyFeature` is the cadence for the optional weekly collection; changing the switch does not rewrite its schedule. Existing product schedules also control timed storefront visibility. Disable or cancel those schedules in Products before turning off the weekly feature if those releases should stop. The feature switch does not silently cancel saved product visibility decisions or delete stored rows.

Signup has no bundled email sender or automatic unsubscribe link. Verify the support mailbox and the owner’s removal workflow before enabling it; follow [signup operations](drop-signup.md). Turning signup off does not suppress a separate external mailing list.

Feature selection does not override setup gates, provider readiness, or visitor marketing choices. Shipping and policy publishing remain independent of these optional features; see [shipping and policy content](storefront-policies.md).
