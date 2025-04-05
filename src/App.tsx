import { useState } from 'react';
import './App.css';
import "@blocknote/core/fonts/inter.css";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { useCreateBlockNote } from "@blocknote/react";

function App() {
  const [count, setCount] = useState(0);

  // Creates a new editor instance
  const editor = useCreateBlockNote({
    // Optional initial content
    initialContent: [
      {
        type: "paragraph",
        content: "Welcome to Horizon - Your Notion-like editor!"
      },
      {
        type: "heading",
        props: { level: 1 },
        content: "Getting Started"
      },
      {
        type: "paragraph",
        content: "Try creating some content with the slash (/) command."
      }
    ]
  });

  return (
    <div className="App">
      <header className="App-header">
        <h1>Horizon</h1>
        <nav className="main-nav">
          <a href="/">Home</a>
          <a href="/profile">Profile</a>
        </nav>
        <p>An Electron.js application with Vite, React, and TypeScript</p>
      </header>
      
      <main className="editor-container">
        {/* Editor component */}
        <BlockNoteView editor={editor} />
      </main>
      
      <footer className="App-footer">
        <div className="card">
          <button onClick={() => setCount((count) => count + 1)}>
            count is {count}
          </button>
          <p>
            Edit <code>src/App.tsx</code> and save to test HMR
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;
