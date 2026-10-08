export function AnimalIcon({size=24}:{size?:number}) {
  return <svg data-animal-icon="true" width={size} height={size} viewBox="0 0 104 112"
    style={{color:'var(--primary)'}} fill="none" stroke="currentColor" strokeWidth="3.2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M41 24C30 20 25 13 23 7C21 2 18 5 20 14C23 24 30 30 35 31M68 24C80 20 84 12 87 5C90-2 94 3 92 11C90 20 85 27 78 32"/>
    <path d="M35 31C26 23 18 24 10 29C15 37 24 42 35 37M78 32C86 25 96 25 101 31C96 39 87 43 79 39"/>
    <path d="M35 31C39 25 46 22 54 24C60 26 65 22 72 26C80 31 82 37 77 44C70 54 77 65 81 73C86 83 85 88 77 90C69 92 59 92 54 88L46 83C42 79 36 79 32 75C27 69 25 57 28 48"/>
    <path d="M47 30C53 35 58 41 61 47L63 31M33 47C38 43 44 47 46 52C41 57 35 56 33 47M76 44C71 42 68 46 69 51C72 52 75 48 76 44"/>
    <circle cx="39" cy="49" r="1.5"/><path d="M57 77C58 72 62 72 66 74C71 77 77 76 81 75M57 77C50 80 51 85 56 88M58 78l5 5M81 80l-2 4"/>
    <path d="M18 43C10 58 17 75 23 86C28 96 26 102 23 109M28 48C20 64 27 80 31 89C35 99 31 106 31 109M55 89C50 98 45 103 43 109"/>
  </svg>;
}
