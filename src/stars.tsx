import { useState } from "react";
import { Star } from "lucide-react";
import { starKinds, type Entity } from "../shared/domain";
import { useHub } from "./state";
import { post } from "./lib/api";

export function StarButton({ record }: { record: Entity }) {
  const { act } = useHub();
  const [busy, setBusy] = useState(false);
  if (!starKinds.includes(record.kind)) return null;
  const label = record.starred ? "取消重点关注" : "重点关注";
  return (
    <button
      className={
        "icon-button star-button" + (record.starred ? " is-starred" : "")
      }
      aria-label={label + record.title}
      aria-pressed={record.starred}
      title={label}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await act(
            () =>
              post("/api/v1/records/" + record.id + "/star", {
                starred: !record.starred,
              }),
            record.starred ? "已取消重点关注" : "已加入重点关注",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <Star size={15} fill={record.starred ? "currentColor" : "none"} />
    </button>
  );
}
