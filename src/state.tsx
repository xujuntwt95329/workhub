import {
  createContext,
  useContext,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { Actor, Entity } from "../shared/domain";
import type { EditorSpec } from "./components";
export type Hub = {
  records: Entity[];
  actor: Actor;
  project: string;
  setProject: Dispatch<SetStateAction<string>>;
  refresh: () => Promise<void>;
  edit: (spec: EditorSpec) => void;
  notify: (message: string, error?: boolean) => void;
  act: <T>(fn: () => Promise<T>, message?: string) => Promise<T | undefined>;
  sample: boolean;
};
export const HubContext = createContext<Hub | null>(null);
export function useHub() {
  const hub = useContext(HubContext);
  if (!hub) throw new Error("Missing Hub provider");
  return hub;
}
export function entityPath(e: Entity) {
  if (e.kind === "task") return "/tasks/" + e.id;
  if (e.kind === "todo" && !e.taskId) return "/todos?focus=" + e.id;

  if (e.taskId)
    return (
      "/tasks/" +
      e.taskId +
      "?tab=" +
      ({
        requirement: "requirements",
        requirement_group: "requirements",
        todo: "todos",
        principle: "principles",
        criterion: "requirements",
        design: "designs",
        work_item: "work",
        issue: "issues",
        check: "tests",
        result: "quality",
        question: "issues",
      }[e.kind as string] ?? "overview") +
      "&focus=" +
      e.id
    );
  return "/tasks";
}
