import { describe, expect, it } from 'vitest'

import { missingColumns } from './ExcelUpload'

describe('missingColumns', () => {
  it('ignores case and surrounding spaces', () => {
    expect(missingColumns({ ' material ': 'x', 'Storage Location': 'y' }, ['Material', 'Storage Location', 'Unrestricted'])).toEqual([
      'Unrestricted',
    ])
  })
})
