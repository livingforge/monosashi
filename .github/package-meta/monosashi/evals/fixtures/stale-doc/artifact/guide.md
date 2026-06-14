# Acme SDK Guide

> Applies to: **Acme SDK v1.0** · Last updated: **2019-03**

This guide explains how to use the Acme SDK to send events.

## Install

```bash
npm install acme-sdk@^1.0.0
```

## Quick start

Create a client and send an event:

```js
// NOTE: the snippet below uses the v3 client API (acme.connect / events.publish),
// which does not exist in v1.0 — v1 used `new Acme(key)` and `acme.send(evt)`.
import { connect } from "acme-sdk";          // v3 import style
const client = await connect({ token: KEY }); // v3 — v1 had no async connect()
await client.events.publish({ type: "signup" }); // v3 namespace; v1 was client.send(...)
```

## Endpoints

- `POST /v1/ingest` — send an event. *(Deprecated since v2; removed in v3 in favour of `/events`.)*
- `POST /v1/batch` — send many events.

## Notes

The screenshots and rate limits in this guide reflect the 2019 dashboard. Some option names
(`retryPolicy`, `flushIntervalMs`) were renamed in later releases; this page has not been updated
and there is no version-to-API mapping table, so it is unclear which parts still apply.
