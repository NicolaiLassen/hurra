import type { QuizQuestion } from './logic'

/**
 * Eight party questions to start from: quick to read out and fun to argue
 * about. They carry no right answer (correct is -1): they ship in the app
 * every phone downloads, so an answer here would be public to anyone who reads
 * the JavaScript. The host picks each one in the editor, and until then the
 * quiz says "Pick the right answer for question n" and won't start.
 */
export const SAMPLE_QUESTIONS: QuizQuestion[] = [
  { text: 'What does the Danish cheer “Hurra” mean in English?', options: ['Hurry up', 'Hooray', 'Cheers', 'Happy birthday'], correct: -1 },
  { text: 'Which country invented LEGO?', options: ['Sweden', 'Germany', 'Denmark', 'Switzerland'], correct: -1 },
  { text: 'In Denmark, what goes up the flagpole on a birthday?', options: ['The Danish flag', 'A balloon', 'A paper crown'], correct: -1 },
  { text: 'How many keys does a standard piano have?', options: ['76', '92', '100', '88'], correct: -1 },
  { text: 'What is a group of flamingos called?', options: ['A parade', 'A flamboyance', 'A blush', 'A disco'], correct: -1 },
  { text: 'True or false: honey can keep for thousands of years.', options: ['True', 'False'], correct: -1, seconds: 10 },
  { text: 'Which animal has three hearts?', options: ['Jellyfish', 'Starfish', 'Octopus', 'Seahorse'], correct: -1 },
  { text: 'What is 30 in Roman numerals?', options: ['XL', 'XXX', 'XXV', 'LXX'], correct: -1 },
]
