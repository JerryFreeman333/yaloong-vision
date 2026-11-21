import React from 'react';
import {ArrowLeft} from 'lucide-react';
import './gallery-return.css';

export function GalleryReturn({brandClass}) {
  return <a className={'gallery-return ' + brandClass} href="./?return=gallery" aria-label="返回图库">
    <span className="gallery-return-brand" aria-hidden="true"><i>///</i> BPX <b>STUDIO</b></span>
    <span className="gallery-return-label"><ArrowLeft size={14} aria-hidden="true"/>返回图库</span>
  </a>;
}
