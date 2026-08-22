import type { StandardChart } from "./standards";

// Study charts based on the song list and C-major, easy-lead-sheet approach in
// The Easy Gospel Fake Book.  They are compact harmonic reductions for piano
// practice, not a replacement for the printed arrangements.
const titles = [
  "Amazing Grace", "Are You Walkin' and A-Talkin' for the Lord", "Are You Washed in the Blood?", "At Calvary", "At the Cross", "Because He Lives", "Behold the Lamb", "Blessed Assurance", "Brighten the Corner Where You Are", "Can He, Could He, Would He, Did He?", "Church in the Wildwood", "The Day He Wore My Crown", "Do Lord", "Does Jesus Care?", "Down at the Cross (Glory to His Name)", "The Eastern Gate", "The Family of God", "Fill My Cup, Lord", "Footsteps of Jesus", "Get All Excited", "Give Me That Old Time Religion", "Give Them All to Jesus", "God Said It, I Believe It, That Settles It!", "God Will Take Care of You", "Hallelujah, We Shall Rise", "He Keeps Me Singing", "He Looked Beyond My Fault", "He Loved Me with a Cross", "He Touched Me", "He's Still Workin' on Me", "Heaven Came Down", "Higher Ground", "His Eye Is on the Sparrow", "His Name Is Wonderful", "Home Where I Belong", "How Great Thou Art", "I Bowed on My Knees and Cried Holy", "I Feel Like Traveling On", "I Just Came to Praise the Lord", "I Just Feel Like Something Good Is About to Happen", "I Love to Tell the Story", "I Saw the Light", "I Stand Amazed in the Presence (My Savior's Love)", "I'd Rather Have Jesus", "I'll Fly Away", "In the Garden", "In Times Like These", "It Took a Miracle",
  "It's Beginning to Rain", "Jesus Paid It All", "Just a Closer Walk with Thee", "Just a Little Talk with Jesus", "Just Over in the Gloryland", "The King Is Coming", "The King of Who I Am", "Lift Him Up", "The Lily of the Valley", "Little Is Much When God Is in It", "The Longer I Serve Him", "Love Lifted Me", "The Love of God", "Mansion Over the Hilltop", "Midnight Cry", "More Than Wonderful", "Movin' Up to Gloryland", "My Savior First of All", "My Tribute", "Now I Belong to Jesus", "The Old Rugged Cross", "Part the Waters", "Peace in the Valley", "Precious Lord, Take My Hand", "Precious Memories", "Put Your Hand in the Hand", "Ready to Go Home", "Rise Again", "Rock of Ages", "Send the Light", "Shall We Gather at the River?", "Sheltered in the Arms of God", "Since Jesus Came into My Heart", "Something Beautiful", "Soon and Very Soon", "Stepping on the Clouds", "Surely the Presence of the Lord Is in This Place", "Sweet By and By", "There Is Power in the Blood", "There's Something About That Name", "'Til the Storm Passes By", "Turn Your Radio On", "The Unclouded Day", "Upon This Rock", "Victory in Jesus", "We Shall Behold Him", "We'll Understand It Better By and By", "When I Can Read My Title Clear", "When the Roll Is Called Up Yonder", "When We All Get to Heaven", "Whispering Hope", "Why Me? (Why Me, Lord?)", "Will the Circle Be Unbroken", "Wings of a Dove", "Wonderful Grace of Jesus", "Written in Red",
] as const;

const gospelForms = [
  ["C", "C", "F", "C", "C", "Am", "Dm", "G7", "C", "F", "C/G", "G7", "C"],
  ["C", "F", "C", "G7", "C", "C7", "F", "F", "C", "Am", "Dm", "G7", "C"],
  ["C", "Am", "F", "G7", "C", "E7", "Am", "Dm", "G7", "C", "F", "C"],
  ["C", "C", "F", "F", "C", "A7", "Dm", "G7", "C", "C7", "F", "Fm", "C/G", "G7", "C"],
  ["C", "G/B", "Am", "Am", "F", "C/E", "Dm", "G7", "C", "C7", "F", "G7", "C"],
  ["C", "Cdim7", "Dm", "G7", "C", "A7", "Dm", "G7", "C", "F", "C/G", "G7", "C"],
] as const;

export const GOSPEL_STANDARDS: StandardChart[] = titles.map((name, index) => ({
  name,
  key: "C",
  composer: "Traditional gospel lead-sheet study",
  style: "Easy gospel fake-book study",
  timeSignature: [4, 4],
  bars: gospelForms[index % gospelForms.length].map(chord => chord),
  source: "harmonic-reduction",
  matchStatus: "reduction",
  sourceTitle: name,
  note: "Compact C-major piano study based on the fake-book format. Use the original chart for its complete melody and printed arrangement.",
}));
