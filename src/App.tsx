import React, { useState, useEffect } from 'react';
import WeddingPhotoApp from './WeddingPhotoApp';
import AdminDashboard from './Admin';

export default function App() {
  const [route, setRoute] = useState(window.location.hash);

  useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  if (route === '#/admin') {
    return <AdminDashboard />;
  }

  return <WeddingPhotoApp />;
}