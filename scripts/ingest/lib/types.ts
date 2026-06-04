import { z } from "zod";

export class ApiError extends Error {
  constructor(public code: string, message: string, public url?: string) {
    super(message);
    this.name = "ApiError";
  }
}

export const ApiResponseSchema = z.object({
  response: z.object({
    header: z.object({
      resultCode: z.string(),
      resultMsg: z.string(),
    }),
    body: z
      .object({
        items: z.any().optional(),
        numOfRows: z.coerce.number().optional(),
        pageNo: z.coerce.number().optional(),
        totalCount: z.coerce.number().optional(),
      })
      .optional(),
  }),
});

// VoteXmntckInfoInqireService2 / getXmntckSttusInfoInqire 응답 행 (wide format).
// 한 행에 메타 + 후보자/정당이 jd01~jd50 / hbj01~hbj50 / dugsu01~dugsu50 으로 펼쳐진다.
// 컬럼 수는 선거 유형마다 다르므로 catchall 로 동적 허용한다.
export const XmntckItemSchema = z.object({
  sgId: z.string(),
  sgTypecode: z.string(),
  sdName: z.string(),
  sggName: z.string().optional(),
  wiwName: z.string().optional(),
}).catchall(z.unknown());
export type XmntckItem = z.infer<typeof XmntckItemSchema>;

export const ElcntItemSchema = z.object({
  sgId: z.string(),
  sdName: z.string(),
  sggName: z.string().optional(),
  wiwName: z.string().optional(),
  popCnt: z.coerce.number().optional(),
  selecMan: z.coerce.number().optional(),
  tvoteNum: z.coerce.number().optional(),
  validNum: z.coerce.number().optional(),
  invalidNum: z.coerce.number().optional(),
  vtRate: z.coerce.number().optional(),
});
export type ElcntItem = z.infer<typeof ElcntItemSchema>;
