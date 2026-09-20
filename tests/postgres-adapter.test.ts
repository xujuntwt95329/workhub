import { it, expect, vi, beforeEach } from "vitest";
const pgMock = vi.hoisted(() => ({
  query: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
  end: vi.fn(),
  connect: vi.fn(),
}));
vi.mock("pg", () => ({
  default: {
    Pool: class {
      query = pgMock.query;
      connect = pgMock.connect;
      end = pgMock.end;
    },
  },
}));
import { openDatabase } from "../server/db";
beforeEach(() => {
  Object.values(pgMock).forEach((m) => m.mockReset());
  pgMock.query.mockResolvedValue({ rows: [] });
  pgMock.clientQuery.mockResolvedValue({ rows: [{ value: 1 }] });
  pgMock.connect.mockResolvedValue({
    query: pgMock.clientQuery,
    release: pgMock.release,
  });
});
it("commits successful PostgreSQL transactions and always releases the connection", async () => {
  const db = await openDatabase("postgresql://test");
  await db.query("SELECT 1");
  const result = await db.transaction((tx) => tx.query("SELECT $1", [1]));
  expect(result.rows).toEqual([{ value: 1 }]);
  expect(pgMock.clientQuery.mock.calls.map((c) => c[0])).toEqual([
    "BEGIN",
    "SELECT $1",
    "COMMIT",
  ]);
  expect(pgMock.release).toHaveBeenCalledOnce();
  await db.close();
  expect(pgMock.end).toHaveBeenCalledOnce();
});
it("rolls back and releases the connection on domain or query errors", async () => {
  const db = await openDatabase("postgresql://test");
  await expect(
    db.transaction(async () => {
      throw new Error("transaction failed");
    }),
  ).rejects.toThrow("transaction failed");
  expect(pgMock.clientQuery.mock.calls.map((c) => c[0])).toEqual([
    "BEGIN",
    "ROLLBACK",
  ]);
  expect(pgMock.release).toHaveBeenCalledOnce();
});
