import { useState } from 'react';
import Bookshelf from './components/Bookshelf';
import Editor from './components/Editor';
import { Toasts } from './components/Toast';

type View = { name: 'shelf' } | { name: 'editor'; root: string; dirName: string };

export default function App() {
  const [view, setView] = useState<View>({ name: 'shelf' });
  return (
    <>
      {view.name === 'shelf' ? (
        <Bookshelf onOpen={(root, dirName) => setView({ name: 'editor', root, dirName })} />
      ) : (
        <Editor
          key={view.dirName}
          root={view.root}
          dirName={view.dirName}
          onExit={() => setView({ name: 'shelf' })}
        />
      )}
      <Toasts />
    </>
  );
}
