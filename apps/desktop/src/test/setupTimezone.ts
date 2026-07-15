import process from "node:process";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

process.env.TZ = "Asia/Seoul";

// React Testing Library's auto-cleanup isn't firing under this vitest config, so
// component test files render into a shared jsdom document and leak DOM into the
// files that run after them in the same worker — broad role/text queries then
// match a prior file's markup and fail non-deterministically. Unmount after every
// test so each starts from a clean document.
afterEach(cleanup);
