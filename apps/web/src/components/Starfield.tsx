import type { CSSProperties } from 'react';

const stars = Array.from({ length: 140 }, (_, index) => ({
  left: `${(index * 73.139 + 7.3) % 100}%`, top: `${(index * index * 19.37 + index * 29.9 + 3) % 100}%`,
  '--star-size': index % 19 === 0 ? '2px' : index % 5 === 0 ? '1.4px' : '1px',
  '--star-light': index % 19 === 0 ? '.68' : '.36',
  '--star-delay': `${-(index % 11)}s`, '--star-period': `${6 + index % 7}s`,
} as CSSProperties));

export function Starfield() {
  return <div className="starfield" aria-hidden="true">{stars.map((style, index) => <i className="ceiling-star" key={index} style={style}/>)}{[0,1,2].map(index=><span className="shooting-star" key={`meteor-${index}`} style={{top:`${8+index*22}%`,'--meteor-delay':`${index*6-16}s`} as CSSProperties}/>)}</div>;
}
