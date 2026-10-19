import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Badge, Spinner } from './components';
import { api, dateTime, mutate } from './lib';
import type { AttributionOptions, Sale } from './types';

export default function SaleAttribution({
  sale,
  onSaved,
}: {
  sale: Sale;
  onSaved: (sale: Sale) => void;
}) {
  const [options, setOptions] = useState<AttributionOptions | null>(null);
  const [campaign, setCampaign] = useState(sale.campaign_id || '');
  const [adset, setAdset] = useState(sale.adset_id || '');
  const [ad, setAd] = useState(sale.ad_id || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setError('');
    api<AttributionOptions>(
      `/sale-attribution-options?${new URLSearchParams({ project: sale.project_id })}`,
    )
      .then((result) => {
        if (active) setOptions(result);
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [sale.project_id, attempt]);
  const campaigns = options?.campaigns || [];
  const adsets = options?.adsets.filter((a) => a.campaign_id === campaign) || [];
  const selectedSet = adsets.some((a) => a.id === adset) ? adset : '';
  const ads = options?.ads.filter((a) => a.adset_id === selectedSet) || [];
  const selectedAd = ads.some((a) => a.id === ad) ? ad : '';
  const validCampaign = campaigns.some((c) => c.id === campaign);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const updated = await mutate<Sale>(
        `/sales/${encodeURIComponent(sale.id)}/attribution`,
        'PATCH',
        {
          project_id: sale.project_id,
          campaign_id: campaign,
          adset_id: selectedSet || null,
          ad_id: selectedAd || null,
        },
      );
      if (mounted.current) onSaved(updated);
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setSaving(false);
    }
  };
  return (
    <section className="sale-attribution">
      <div className="attribution-heading">
        <h3>Atribuição da venda</h3>
        <Badge tone={sale.campaign_id ? 'green' : 'amber'}>
          {sale.attribution_method === 'manual'
            ? 'Manual'
            : sale.campaign_id
              ? 'Automática'
              : 'Sem atribuição'}
        </Badge>
      </div>
      <p className="muted">
        Confira as UTMs recebidas e selecione a origem desta venda. Conjunto e anúncio são
        opcionais.
      </p>
      <dl className="sale-utm-values" aria-label="UTMs recebidas">
        {[
          ['utm_source', sale.utm_source],
          ['utm_medium', sale.utm_medium],
          ['utm_campaign', sale.utm_campaign],
          ['utm_term · conjunto', sale.utm_term],
          ['utm_content · anúncio', sale.utm_content],
          ...(sale.adset_reference && sale.adset_reference !== sale.utm_term
            ? [['Referência do conjunto', sale.adset_reference]]
            : []),
          ...(sale.ad_reference && sale.ad_reference !== sale.utm_content
            ? [['Referência do anúncio', sale.ad_reference]]
            : []),
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value || 'Não informado'}</dd>
          </div>
        ))}
      </dl>
      {!options && !error && <Spinner />}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!options && error && (
        <button className="button secondary" onClick={() => setAttempt((v) => v + 1)}>
          Tentar novamente
        </button>
      )}
      {options && (
        <form className="stack-form" onSubmit={(event) => void save(event)}>
          <label>
            Campanha
            <select
              required
              value={validCampaign ? campaign : ''}
              disabled={saving}
              onChange={(e) => {
                setCampaign(e.target.value);
                setAdset('');
                setAd('');
              }}
            >
              <option value="">Selecione uma campanha</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.external_id || c.id}
                  {c.account_id ? ` · ${c.account_id}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            Conjunto de anúncios
            <select
              value={selectedSet}
              disabled={!validCampaign || saving || !adsets.length}
              onChange={(e) => {
                setAdset(e.target.value);
                setAd('');
              }}
            >
              <option value="">
                {campaign && !adsets.length
                  ? 'Nenhum conjunto disponível'
                  : 'Sem conjunto selecionado'}
              </option>
              {adsets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.external_id || a.id}
                </option>
              ))}
            </select>
          </label>
          <label>
            Anúncio
            <select
              value={selectedAd}
              disabled={!selectedSet || saving || !ads.length}
              onChange={(e) => setAd(e.target.value)}
            >
              <option value="">
                {selectedSet && !ads.length
                  ? 'Nenhum anúncio disponível'
                  : 'Sem anúncio selecionado'}
              </option>
              {ads.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.external_id || a.id}
                </option>
              ))}
            </select>
          </label>
          {!campaigns.length && (
            <p className="muted">
              Sincronize suas campanhas em Integrações → Meta Ads ou cadastre uma campanha na
              operação.
            </p>
          )}
          <p className="muted">
            A seleção manual será mantida nas próximas sincronizações. As UTMs recebidas continuam
            disponíveis acima.
          </p>
          {sale.attribution_updated_at && (
            <small className="muted">
              Atribuição manual salva em {dateTime(sale.attribution_updated_at)}.
            </small>
          )}
          <button className="button primary" disabled={!validCampaign || saving} type="submit">
            {saving ? 'Salvando…' : 'Salvar atribuição'}
          </button>
        </form>
      )}
    </section>
  );
}
