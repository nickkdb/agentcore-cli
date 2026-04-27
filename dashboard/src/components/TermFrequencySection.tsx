import type { TermCount } from '../types.js';

export default function TermFrequencySection({ terms, unusedLabels }: { terms: TermCount[]; unusedLabels: string[] }) {
  return (
    <>
      {terms.length > 0 && (
        <div class="tbl">
          <table>
            <thead>
              <tr>
                <th>Term</th>
                <th>Occurrences in Unlabeled Issues</th>
              </tr>
            </thead>
            <tbody>
              {terms.map(t => (
                <tr>
                  <td>
                    <span class="b b-blue">{t.term}</span>
                  </td>
                  <td>{t.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {unusedLabels.length > 0 && (
        <div class="extra">
          <h4>Defined but Unused Labels</h4>
          <div>
            {unusedLabels.map(l => (
              <span class="b b-yellow" style={{ margin: '2px' }}>
                {l}
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
