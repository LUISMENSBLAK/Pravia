import { useState } from 'react';
import { CommercialPropertyPicker } from '../../properties/CommercialPropertyPicker';
import type { CommercialPropertyState } from '../../properties/commercialProperty';
import type { Quote } from '../quotes.types';
import { QuotePropertyValues } from './QuotePropertyValues';

export function QuotePropertySection({ quote, canWrite, onSaved, notify }: {
  quote: Quote; canWrite: boolean; onSaved: () => Promise<void> | void; notify: (message: string) => void;
}) {
  const [source, setSource] = useState<CommercialPropertyState | null>(null);
  const [dirty, setDirty] = useState(false);
  return <>
    <CommercialPropertyPicker kind="cotizacion" id={quote.id} refreshKey={quote.updated_at} navigationBlocked={dirty}
      onChange={(state) => {
        setSource(state);
        if (new Date(state.expected_updated_at).getTime() !== new Date(quote.updated_at).getTime()) void onSaved();
      }} />
    {source && <QuotePropertyValues quote={quote} canWrite={canWrite && source.capabilities.canWrite}
      linkedState={source} onSaved={onSaved} notify={notify} onDirtyChange={setDirty} />}
  </>;
}
