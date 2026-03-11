/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  deleteDoc, 
  doc,
  getDocFromServer
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { BMIRecord } from './types';
import { format } from 'date-fns';
import { 
  Activity, 
  History, 
  LogOut, 
  Plus, 
  Trash2, 
  User as UserIcon,
  Scale,
  Ruler,
  AlertCircle,
  TrendingUp,
  ChevronRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// --- Utility ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Error Handling ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Components ---

const ErrorBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [hasError, setHasError] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      try {
        const parsed = JSON.parse(event.error.message);
        if (parsed.error) {
          setErrorMsg(`Database error: ${parsed.error}`);
        }
      } catch {
        setErrorMsg(event.error.message);
      }
      setHasError(true);
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (hasError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 p-4">
        <div className="card p-8 max-w-md w-full text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
          <p className="text-zinc-500 mb-6">{errorMsg}</p>
          <button 
            onClick={() => window.location.reload()}
            className="w-full py-2 bg-zinc-900 text-white rounded-xl font-medium hover:bg-zinc-800 transition-colors"
          >
            Reload Application
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

const BMICategoryBadge = ({ category }: { category: string }) => {
  const colors = {
    'Underweight': 'bg-blue-100 text-blue-700',
    'Normal': 'bg-emerald-100 text-emerald-700',
    'Overweight': 'bg-amber-100 text-amber-700',
    'Obese': 'bg-red-100 text-red-700',
  };
  const color = colors[category as keyof typeof colors] || 'bg-zinc-100 text-zinc-700';
  
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", color)}>
      {category}
    </span>
  );
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [records, setRecords] = useState<BMIRecord[]>([]);
  const [weight, setWeight] = useState<string>('');
  const [height, setHeight] = useState<string>('');
  const [heightUnit, setHeightUnit] = useState<'cm' | 'ft'>('cm');
  const [feet, setFeet] = useState<string>('');
  const [inches, setInches] = useState<string>('');
  const [isCalculating, setIsCalculating] = useState(false);

  // --- Auth ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Login failed', error);
    }
  };

  const handleLogout = () => signOut(auth);

  // --- Firestore Connection Test ---
  useEffect(() => {
    if (isAuthReady && user) {
      const testConnection = async () => {
        try {
          await getDocFromServer(doc(db, 'test', 'connection'));
        } catch (error) {
          if (error instanceof Error && error.message.includes('the client is offline')) {
            console.error("Please check your Firebase configuration.");
          }
        }
      };
      testConnection();
    }
  }, [isAuthReady, user]);

  // --- Data Fetching ---
  useEffect(() => {
    if (!isAuthReady || !user) return;

    const q = query(
      collection(db, 'bmiRecords'),
      where('userId', '==', user.uid),
      orderBy('timestamp', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as BMIRecord[];
      setRecords(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'bmiRecords');
    });

    return () => unsubscribe();
  }, [isAuthReady, user]);

  // --- Logic ---
  const calculateBMI = (w: number, h: number) => {
    const heightInMeters = h / 100;
    const bmi = w / (heightInMeters * heightInMeters);
    let category = '';
    if (bmi < 18.5) category = 'Underweight';
    else if (bmi < 25) category = 'Normal';
    else if (bmi < 30) category = 'Overweight';
    else category = 'Obese';
    return { bmi: parseFloat(bmi.toFixed(1)), category };
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !weight) return;

    let h = 0;
    if (heightUnit === 'cm') {
      if (!height) return;
      h = parseFloat(height);
    } else {
      if (!feet) return;
      const f = parseFloat(feet);
      const i = parseFloat(inches || '0');
      h = (f * 30.48) + (i * 2.54);
    }

    if (isNaN(h) || h <= 0) return;

    setIsCalculating(true);
    const w = parseFloat(weight);
    const { bmi, category } = calculateBMI(w, h);

    const newRecord: Omit<BMIRecord, 'id'> = {
      userId: user.uid,
      weight: w,
      height: parseFloat(h.toFixed(1)),
      bmi,
      category,
      timestamp: new Date().toISOString(),
    };

    try {
      await addDoc(collection(db, 'bmiRecords'), newRecord);
      setWeight('');
      setHeight('');
      setFeet('');
      setInches('');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'bmiRecords');
    } finally {
      setIsCalculating(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'bmiRecords', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `bmiRecords/${id}`);
    }
  };

  const latestRecord = records[0];

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        >
          <Activity className="w-8 h-8 text-zinc-300" />
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="card p-8 max-w-md w-full text-center"
        >
          <div className="w-16 h-16 bg-zinc-900 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Activity className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-semibold mb-2">BMI Tracker Pro</h1>
          <p className="text-zinc-500 mb-8">Sign in to track your health progress and keep a history of your BMI records.</p>
          <button 
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-3 py-3 bg-white border border-zinc-200 rounded-xl font-medium hover:bg-zinc-50 transition-colors"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
            Continue with Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-zinc-50 pb-20">
        {/* Header */}
        <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-zinc-200/50">
          <div className="max-w-2xl mx-auto px-4 h-16 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-6 h-6 text-zinc-900" />
              <span className="font-semibold text-lg">BMI Tracker</span>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-sm text-zinc-500">
                <UserIcon className="w-4 h-4" />
                <span className="hidden sm:inline">{user.displayName}</span>
              </div>
              <button 
                onClick={handleLogout}
                className="p-2 text-zinc-400 hover:text-red-500 transition-colors"
                title="Logout"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </header>

        <main className="max-w-2xl mx-auto px-4 pt-8 space-y-6">
          {/* Summary Card */}
          {latestRecord && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="card p-6 bg-zinc-900 text-white border-none"
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <p className="text-zinc-400 text-sm font-medium uppercase tracking-wider">Latest BMI</p>
                  <h2 className="text-5xl font-light mt-1">{latestRecord.bmi}</h2>
                </div>
                <BMICategoryBadge category={latestRecord.category} />
              </div>
              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-white/10">
                <div>
                  <p className="text-zinc-500 text-xs uppercase">Weight</p>
                  <p className="font-medium">{latestRecord.weight} kg</p>
                </div>
                <div>
                  <p className="text-zinc-500 text-xs uppercase">Height</p>
                  <p className="font-medium">{latestRecord.height} cm</p>
                </div>
              </div>
            </motion.div>
          )}

          {/* Calculator Form */}
          <div className="card p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Plus className="w-5 h-5 text-zinc-400" />
                <h3 className="font-semibold">New Entry</h3>
              </div>
              <div className="flex bg-zinc-100 p-1 rounded-lg">
                <button 
                  onClick={() => setHeightUnit('cm')}
                  className={cn(
                    "px-3 py-1 text-xs font-medium rounded-md transition-all",
                    heightUnit === 'cm' ? "bg-white shadow-sm text-zinc-900" : "text-zinc-500 hover:text-zinc-700"
                  )}
                >
                  CM
                </button>
                <button 
                  onClick={() => setHeightUnit('ft')}
                  className={cn(
                    "px-3 py-1 text-xs font-medium rounded-md transition-all",
                    heightUnit === 'ft' ? "bg-white shadow-sm text-zinc-900" : "text-zinc-500 hover:text-zinc-700"
                  )}
                >
                  FT/IN
                </button>
              </div>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-500 uppercase flex items-center gap-1.5">
                    <Scale className="w-3 h-3" /> Weight (kg)
                  </label>
                  <input 
                    type="number" 
                    step="0.1"
                    required
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    placeholder="70.5"
                    className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-900/5 focus:border-zinc-900 transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-500 uppercase flex items-center gap-1.5">
                    <Ruler className="w-3 h-3" /> Height ({heightUnit === 'cm' ? 'cm' : 'ft/in'})
                  </label>
                  {heightUnit === 'cm' ? (
                    <input 
                      type="number" 
                      step="0.1"
                      required
                      value={height}
                      onChange={(e) => setHeight(e.target.value)}
                      placeholder="175"
                      className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-900/5 focus:border-zinc-900 transition-all"
                    />
                  ) : (
                    <div className="flex gap-2">
                      <input 
                        type="number" 
                        required
                        value={feet}
                        onChange={(e) => setFeet(e.target.value)}
                        placeholder="5"
                        className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-900/5 focus:border-zinc-900 transition-all"
                      />
                      <input 
                        type="number" 
                        value={inches}
                        onChange={(e) => setInches(e.target.value)}
                        placeholder="9"
                        className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-900/5 focus:border-zinc-900 transition-all"
                      />
                    </div>
                  )}
                </div>
              </div>
              <button 
                type="submit"
                disabled={isCalculating}
                className="w-full py-3 bg-zinc-900 text-white rounded-xl font-medium hover:bg-zinc-800 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
              >
                {isCalculating ? 'Saving...' : 'Calculate & Save'}
              </button>
            </form>
          </div>

          {/* History */}
          <div className="space-y-4">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-zinc-400" />
                <h3 className="font-semibold">History</h3>
              </div>
              <span className="text-xs text-zinc-400 font-medium">{records.length} entries</span>
            </div>
            
            <div className="space-y-3">
              <AnimatePresence initial={false}>
                {records.map((record) => (
                  <motion.div 
                    key={record.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="card p-4 flex items-center justify-between group"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-zinc-50 rounded-xl flex items-center justify-center font-mono font-semibold text-zinc-900">
                        {record.bmi}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-medium">{format(new Date(record.timestamp), 'MMM d, yyyy')}</span>
                          <BMICategoryBadge category={record.category} />
                        </div>
                        <p className="text-xs text-zinc-400">
                          {record.weight}kg · {record.height}cm
                        </p>
                      </div>
                    </div>
                    <button 
                      onClick={() => record.id && handleDelete(record.id)}
                      className="p-2 text-zinc-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>

              {records.length === 0 && (
                <div className="text-center py-12 bg-zinc-100/50 rounded-2xl border border-dashed border-zinc-200">
                  <TrendingUp className="w-8 h-8 text-zinc-300 mx-auto mb-2" />
                  <p className="text-zinc-400 text-sm">No records yet. Start by adding your first entry!</p>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </ErrorBoundary>
  );
}
