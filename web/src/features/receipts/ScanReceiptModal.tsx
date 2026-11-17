import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Camera, Check, Pencil, RotateCcw, Search } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { displayIngredientName } from "../../../../shared/normalize";
import type { ReceiptLineView, ReceiptSaveResponse, ReceiptView } from "../../../../shared/receipts";
import type { Store } from "../../../../shared/schema";
import { MultiStepModal, type ModalStep } from "../../components/Modal";
import { cx } from "../../lib/cx";
import { shoppingApi } from "../shopping/api";
import { receiptApi } from "./api";
import { downscaleImage } from "./downscale";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// One choice per line: the ingredient id, or null for "not a recipe item".
type Choice = { id: number | null; name: string | null };

// Shop ⋯ > Scan a receipt. Step 1 takes the photo (the camera on Android)
// and the store; Next uploads it and Claude reads it. Step 2 checks each
// line's match, and "Save prices" stores them as that store's prices.
// Mount it only while open, so each scan starts clean.
export function ScanReceiptModal({
  open,
  onClose,
  stores,
  defaultStoreId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  stores: Store[];
  defaultStoreId: number | null;
  onSaved?: (result: ReceiptSaveResponse, store: Store | undefined) => void;
}) {
  const qc = useQueryClient();
  const [storeId, setStoreId] = useState<number | null>(defaultStoreId ?? stores[0]?.id ?? null);
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptView | null>(null);
  const [choices, setChoices] = useState<Record<number, Choice>>({});

  useEffect(() => () => void (photo && URL.revokeObjectURL(photo.url)), [photo]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setPreparing(true);
    try {
      const blob = await downscaleImage(file);
      setPhoto({ blob, url: URL.createObjectURL(blob) });
    } catch {
      setError("Couldn't open that photo. Try another.");
    } finally {
      setPreparing(false);
    }
  };

  const read = async () => {
    if (!photo || storeId == null) throw new Error("no photo");
    setError(null);
    try {
      const r = await receiptApi.upload(photo.blob, storeId);
      setReceipt(r);
      setChoices({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reading the receipt failed. Try again.");
      throw err;
    }
  };

  const save = async () => {
    if (!receipt) return;
    setError(null);
    try {
      const lines = Object.entries(choices).map(([id, c]) => ({ id: Number(id), ingredientId: c.id }));
      const result = await receiptApi.save(receipt.id, { lines });
      await qc.invalidateQueries({ queryKey: ["shopping"] });
      onSaved?.(result, stores.find((s) => s.id === receipt.storeId));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Saving failed. Try again.");
      throw err;
    }
  };

  const store = stores.find((s) => s.id === (receipt?.storeId ?? storeId));
  const lineChoice = (l: ReceiptLineView): Choice => choices[l.id] ?? { id: l.ingredientId, name: l.ingredientName };
  const matched = receipt ? receipt.lines.filter((l) => lineChoice(l).id != null).length : 0;

  const steps: ModalStep[] = [
    {
      id: "photo",
      label: "Photo",
      title: "Scan a receipt",
      description: "Walmart, Publix or Aldi. The photo is only read, never kept.",
      canAdvance: !!photo && storeId != null && !preparing,
      primary: { label: "Read receipt" },
      onNext: read,
      render: () => (
        <PhotoStep
          stores={stores}
          storeId={storeId}
          onStore={setStoreId}
          photo={photo?.url ?? null}
          preparing={preparing}
          onPick={pick}
          error={error}
        />
      ),
    },
    {
      id: "check",
      label: "Check",
      title: "Check the matches",
      description: receipt
        ? `${matched} of ${receipt.lines.length} lines are recipe items. Their prices are saved for ${store?.name ?? "this store"}.`
        : undefined,
      render: () =>
        receipt && (
          <div className="grid gap-3">
            <ul className="m-0 grid list-none gap-2 p-0">
              {receipt.lines.map((l) => (
                <MatchRow key={l.id} line={l} choice={lineChoice(l)} onChoose={(c) => setChoices((cs) => ({ ...cs, [l.id]: c }))} />
              ))}
            </ul>
            {error && (
              <p role="alert" className="m-0 text-sm font-semibold text-danger">
                {error}
              </p>
            )}
          </div>
        ),
    },
  ];

  return <MultiStepModal open={open} onClose={onClose} steps={steps} finishLabel="Save prices" onFinish={save} />;
}

function PhotoStep({
  stores,
  storeId,
  onStore,
  photo,
  preparing,
  onPick,
  error,
}: {
  stores: Store[];
  storeId: number | null;
  onStore: (id: number) => void;
  photo: string | null;
  preparing: boolean;
  onPick: (file: File | undefined) => void;
  error: string | null;
}) {
  const inputId = useId();
  const input = (
    <input
      id={inputId}
      type="file"
      accept="image/*"
      capture="environment"
      className="sr-only"
      onChange={(e) => {
        onPick(e.target.files?.[0]);
        e.target.value = "";
      }}
    />
  );
  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <p className="m-0 text-sm font-semibold" id={`${inputId}-store`}>
          Store
        </p>
        <div role="radiogroup" aria-labelledby={`${inputId}-store`} className="grid grid-cols-3 gap-2">
          {stores.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={s.id === storeId}
              onClick={() => onStore(s.id)}
              className={cx(
                "pressable min-h-11 rounded-sm px-2 font-bold",
                s.id === storeId ? "bg-primary text-on-primary" : "bg-surface-2 text-text",
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>

      {photo ? (
        <div className="grid gap-2">
          <img src={photo} alt="The receipt photo" className="max-h-[42vh] w-full rounded-sm bg-surface-2 object-contain" />
          <label
            htmlFor={inputId}
            className="pressable inline-flex min-h-11 items-center justify-center gap-2 justify-self-center rounded-full px-4 font-semibold text-primary"
          >
            <RotateCcw size={18} aria-hidden="true" />
            Retake
          </label>
        </div>
      ) : (
        <label
          htmlFor={inputId}
          className="pressable grid min-h-40 place-items-center content-center gap-2 rounded-card border-2 border-dashed border-border px-4 py-6 text-center"
        >
          <span className="grid size-14 place-items-center rounded-full bg-primary text-on-primary">
            <Camera size={26} aria-hidden="true" />
          </span>
          <span className="font-bold">{preparing ? "Getting the photo ready…" : "Take a photo of the receipt"}</span>
          <span className="text-sm text-muted">Lay it flat with the whole receipt in the frame.</span>
        </label>
      )}
      {input}
      {error && (
        <p role="alert" className="m-0 text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

// "GV SHRD MOZZ 8OZ → Shredded mozzarella cheese · $2.48 (8 oz)". The match
// is a button that opens a search to change it.
function MatchRow({ line, choice, onChoose }: { line: ReceiptLineView; choice: Choice; onChoose: (c: Choice) => void }) {
  const [editing, setEditing] = useState(false);
  const isItem = choice.id != null;
  const unit = line.price.unit === "each" ? (line.quantity > 1 ? `each, ${line.quantity} bought` : null) : `per ${line.price.unit.replace(/^1 /, "")}`;
  return (
    <li className={cx("grid gap-1 rounded-sm px-3 py-2", isItem ? "bg-surface-2" : "border border-border")}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-semibold uppercase tracking-wide text-muted">{line.text}</span>
        <span className="shrink-0 text-right font-bold tabular-nums">
          {money(line.price.cents)}
          {unit && <span className="block text-xs font-semibold text-muted">{unit}</span>}
        </span>
      </div>
      <button
        type="button"
        aria-expanded={editing}
        onClick={() => setEditing((e) => !e)}
        className="pressable -mx-1 flex min-h-11 items-center gap-1.5 rounded-sm px-1 text-left"
      >
        <ArrowRight size={16} aria-hidden="true" className="shrink-0 text-muted" />
        <span className="sr-only">Matched to </span>
        <span className={cx("min-w-0 flex-1 truncate", isItem ? "font-bold" : "text-muted")}>
          {isItem ? displayIngredientName(choice.name ?? "") : "Not a recipe item"}
        </span>
        <Pencil size={16} aria-hidden="true" className="shrink-0 text-muted" />
        <span className="sr-only">, change</span>
      </button>
      {editing && (
        <IngredientSearch
          initial={isItem ? (choice.name ?? "") : ""}
          current={choice.id}
          onChoose={(c) => {
            onChoose(c);
            setEditing(false);
          }}
        />
      )}
    </li>
  );
}

function IngredientSearch({ initial, current, onChoose }: { initial: string; current: number | null; onChoose: (c: Choice) => void }) {
  const [q, setQ] = useState(initial);
  const term = q.trim();
  const results = useQuery({
    queryKey: ["ingredient-search", term],
    queryFn: ({ signal }) => shoppingApi.searchIngredients(term, signal),
    enabled: term.length > 0,
    placeholderData: (prev) => prev,
  });
  const option = "pressable flex min-h-11 w-full items-center gap-2 rounded-sm px-2 text-left";
  return (
    <div className="grid gap-1 pb-1">
      <label className="relative block">
        <span className="sr-only">Search recipe items</span>
        <Search size={18} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={q}
          autoFocus
          onChange={(e) => setQ(e.target.value)}
          className="block min-h-11 w-full rounded-sm border border-border bg-surface py-2 pl-10 pr-3 text-base text-text placeholder:text-muted"
          placeholder="Search recipe items"
        />
      </label>
      <ul className="m-0 grid list-none p-0">
        {term.length > 0 &&
          results.data?.map((i) => (
            <li key={i.id}>
              <button type="button" className={option} onClick={() => onChoose({ id: i.id, name: i.name })}>
                <span className="min-w-0 flex-1 truncate">{displayIngredientName(i.name)}</span>
                {i.id === current && <Check size={18} aria-hidden="true" className="text-primary" />}
              </button>
            </li>
          ))}
        {term.length > 0 && results.isSuccess && results.data.length === 0 && (
          <li className="px-2 py-2 text-sm text-muted">No recipe items match “{term}”.</li>
        )}
        <li>
          <button type="button" className={cx(option, "text-muted")} onClick={() => onChoose({ id: null, name: null })}>
            <span className="flex-1">Not a recipe item</span>
            {current === null && <Check size={18} aria-hidden="true" className="text-primary" />}
          </button>
        </li>
      </ul>
    </div>
  );
}
