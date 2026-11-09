import type { QuizQuestion } from './logic'

/**
 * Eight party questions to start from: quick to read out, fun to argue about,
 * and with the right answer in a different place each time.
 */
export const SAMPLE_QUESTIONS: QuizQuestion[] = [
  { text: 'What does the Danish cheer “Hurra” mean in English?', options: ['Hurry up', 'Hooray', 'Cheers', 'Happy birthday'], correct: 1 },
  { text: 'Which country invented LEGO?', options: ['Sweden', 'Germany', 'Denmark', 'Switzerland'], correct: 2 },
  { text: 'In Denmark, what goes up the flagpole on a birthday?', options: ['The Danish flag', 'A balloon', 'A paper crown'], correct: 0 },
  { text: 'How many keys does a standard piano have?', options: ['76', '92', '100', '88'], correct: 3 },
  { text: 'What is a group of flamingos called?', options: ['A parade', 'A flamboyance', 'A blush', 'A disco'], correct: 1 },
  { text: 'True or false: honey can keep for thousands of years.', options: ['True', 'False'], correct: 0, seconds: 10 },
  { text: 'Which animal has three hearts?', options: ['Jellyfish', 'Starfish', 'Octopus', 'Seahorse'], correct: 2 },
  { text: 'What is 30 in Roman numerals?', options: ['XL', 'XXX', 'XXV', 'LXX'], correct: 1 },
]
