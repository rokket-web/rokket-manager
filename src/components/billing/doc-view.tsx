import { formatCents } from "@/lib/money";
import { formatQuantity } from "@/lib/billing";
import { bpsToPercent } from "@/lib/tax";

type Line = {
  id: string;
  description: string;
  quantityMilli: number;
  unitPriceCents: number;
  taxable: boolean;
  amountCents: number;
};

export function LinesTable({
  lines,
  currency,
  subtotalCents,
  taxCents,
  totalCents,
  taxRateBps,
  paidCents,
}: {
  lines: Line[];
  currency: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  taxRateBps: number;
  paidCents?: number;
}) {
  const f = (c: number) => formatCents(c, currency);
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="p-2">Description</th>
              <th className="p-2 text-right">Qty</th>
              <th className="p-2 text-right">Unit price</th>
              <th className="p-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="p-2">
                  {l.description}
                  {!l.taxable && <span className="text-muted-foreground ml-2 text-xs">(not taxed)</span>}
                </td>
                <td className="p-2 text-right tabular-nums">{formatQuantity(l.quantityMilli)}</td>
                <td className="p-2 text-right tabular-nums">{f(l.unitPriceCents)}</td>
                <td className="p-2 text-right tabular-nums">{f(l.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="ml-auto w-full max-w-xs space-y-1 text-sm">
        <div className="flex justify-between">
          <dt>Subtotal</dt>
          <dd className="tabular-nums">{f(subtotalCents)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Tax ({bpsToPercent(taxRateBps)}%)</dt>
          <dd className="tabular-nums">{f(taxCents)}</dd>
        </div>
        <div className="flex justify-between border-t pt-1 font-semibold">
          <dt>Total</dt>
          <dd className="tabular-nums">{f(totalCents)}</dd>
        </div>
        {paidCents !== undefined && paidCents > 0 && (
          <>
            <div className="flex justify-between">
              <dt>Paid</dt>
              <dd className="tabular-nums">-{f(paidCents)}</dd>
            </div>
            <div className="flex justify-between font-semibold">
              <dt>Balance due</dt>
              <dd className="tabular-nums">{f(Math.max(0, totalCents - paidCents))}</dd>
            </div>
          </>
        )}
      </dl>
    </div>
  );
}
